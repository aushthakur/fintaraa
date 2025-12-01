import { ClientSession, Types } from "mongoose";
import Lander, { ILander } from "../modals/lander.model";
import { LoanQuery, ILoanQuery, LoanQueryActivityType } from "../modals/loanquery.model";
import { InsuranceQuery, IInsuranceQuery, InsuranceQueryActivityType } from "../modals/insurancequery.model";

interface AssignmentContext {
  actorId?: string;
  reason?: string;
  session?: ClientSession;
  mode?: "auto" | "manual" | "reassign";
}

/**
 * Calculate the numeric distance between two pincodes
 * For Indian pincodes (6 digits), we calculate the absolute difference
 */
const calculatePincodeDistance = (
  pincode1: string,
  pincode2: string
): number => {
  const num1 = parseInt(pincode1.replace(/\D/g, ""), 10);
  const num2 = parseInt(pincode2.replace(/\D/g, ""), 10);
  if (isNaN(num1) || isNaN(num2)) return Infinity;
  return Math.abs(num1 - num2);
};

/**
 * Find the nearest pincode from a list of serviceable pincodes
 */
const findNearestPincode = (
  targetPincode: string,
  serviceablePincodes: string[]
): { pincode: string; distance: number } | null => {
  if (!targetPincode || !serviceablePincodes?.length) return null;

  let nearest: { pincode: string; distance: number } | null = null;

  for (const pincode of serviceablePincodes) {
    const distance = calculatePincodeDistance(targetPincode, pincode);
    if (!nearest || distance < nearest.distance) {
      nearest = { pincode, distance };
    }
  }

  return nearest;
};

class LanderAssignmentEngine {
  /**
   * Ensure a lander is assigned to the query
   */
  static async ensureAssignment(
    query: ILoanQuery | IInsuranceQuery,
    context: AssignmentContext
  ): Promise<ILoanQuery | IInsuranceQuery> {
    // Skip if already assigned
    if ((query as ILoanQuery).assignedLander || (query as IInsuranceQuery).assignedLander) {
      return query;
    }

    const pincode = this.extractPincode(query);
    if (!pincode) {
      return query; // Cannot assign without pincode
    }

    const lander = await this.findBestLander(pincode);
    if (!lander) {
      return query; // No available lander
    }

    return this.applyAssignment(query, lander, { ...context, mode: "auto" });
  }

  /**
   * Reassign query to a specific lander
   */
  static async reassignQuery(
    query: ILoanQuery | IInsuranceQuery,
    lander: ILander,
    context: AssignmentContext
  ): Promise<ILoanQuery | IInsuranceQuery> {
    return this.applyAssignment(query, lander, {
      ...context,
      mode: context.mode || "reassign",
    });
  }

  /**
   * Adjust lander's active leads count
   */
  static async adjustLanderLoad(
    landerId?: Types.ObjectId,
    delta = 0,
    session?: ClientSession
  ) {
    if (!landerId || !delta) return;
    const update: Record<string, any> = { $inc: { activeLeads: delta } };
    if (delta > 0) {
      update.$set = { lastLeadAssignedAt: new Date() };
    }
    await Lander.updateOne({ _id: landerId }, update, { session });
  }

  /**
   * Extract pincode from query (loan or insurance)
   */
  private static extractPincode(
    query: ILoanQuery | IInsuranceQuery
  ): string | null {
    // Both loan and insurance queries have pincode field
    if ("pincode" in query && query.pincode) {
      return query.pincode.toString().trim();
    }

    return null;
  }

  /**
   * Compute priority score for lander assignment (lower is better)
   */
  private static computePriorityScore(
    userPincode: string,
    lander: ILander
  ): number {
    const serviceablePincodes = lander.serviceablePincodes || [];
    const activeLeads = lander.activeLeads || 0;

    // Check if exact pincode match exists
    const exactMatch = serviceablePincodes.some(
      (pincode) => pincode.toString().trim() === userPincode.trim()
    );

    // Load score: activeLeads / capacity
    const capacity = lander.leadCapacity || 50;
    const loadScore = capacity > 0 ? activeLeads / capacity : 1;

    // Geography penalty: 0 for exact match, distance-based penalty for nearest match
    let geoPenalty = 0;
    if (!exactMatch) {
      const nearest = findNearestPincode(userPincode, serviceablePincodes);
      if (nearest) {
        // Normalize distance (pincode difference) to penalty (0-0.5 range)
        // Max distance between Indian pincodes is ~999999, normalize to 0-0.5
        geoPenalty = Math.min(nearest.distance / 2000000, 0.5);
      } else {
        // No serviceable pincodes at all - high penalty
        geoPenalty = 0.5;
      }
    }

    // Time factor: favor landers who haven't been assigned recently
    // This creates a round-robin effect
    const timeFactor = lander.lastLeadAssignedAt
      ? lander.lastLeadAssignedAt.getTime() / 1_000_000_000_000
      : 0;

    // Performance boost: favor landers with higher completion rate
    const totalLeads = (lander.activeLeads || 0) + (lander.completedLeads || 0);
    const completionRate =
      totalLeads > 0 ? (lander.completedLeads || 0) / totalLeads : 0;
    const performanceBoost = -completionRate * 0.1; // Negative because lower score is better

    return Number(
      loadScore + geoPenalty + timeFactor + performanceBoost
    );
  }

  /**
   * Find the best lander for assignment
   */
  private static async findBestLander(
    userPincode: string
  ): Promise<ILander | null> {
    // Step 1: Find all available landers
    const allLanders = await Lander.find({
      availability: true,
    });

    if (allLanders.length === 0) return null;

    // Step 2: Filter by exact pincode match first
    const exactMatchLanders = allLanders.filter((lander) => {
      const serviceablePincodes = lander.serviceablePincodes || [];
      return serviceablePincodes.some(
        (pincode) => pincode.toString().trim() === userPincode.trim()
      );
    });

    // Step 3: If exact matches exist, score only those
    // Otherwise, score all landers (will use nearest pincode logic)
    const candidates = exactMatchLanders.length > 0 
      ? exactMatchLanders 
      : allLanders;

    // Step 4: Score and sort all candidates
    const scored = candidates
      .map((lander) => ({
        lander,
        score: this.computePriorityScore(userPincode, lander),
      }))
      .sort((a, b) => a.score - b.score);

    return scored[0]?.lander || null;
  }

  /**
   * Apply assignment to query
   */
  private static async applyAssignment(
    query: ILoanQuery | IInsuranceQuery,
    lander: ILander,
    context: AssignmentContext
  ): Promise<ILoanQuery | IInsuranceQuery> {
    if (!lander) return query;

    const previousLanderId =
      (query as ILoanQuery).assignedLander ||
      (query as IInsuranceQuery).assignedLander;
    const landerId = lander._id as Types.ObjectId;

    // Update query with assigned lander
    if ("assignedLander" in query) {
      (query as any).assignedLander = landerId;
    }

    // Add activity
    const isLoanQuery = "loanType" in query;
    const activityType = isLoanQuery
      ? LoanQueryActivityType.LANDER_ASSIGNED
      : InsuranceQueryActivityType.LANDER_ASSIGNED;

    const activities = (query as any).activities || [];
    activities.push({
      type: activityType,
      description: `Lander assigned: ${lander.name}`,
      actor: context.actorId ? new Types.ObjectId(context.actorId) : undefined,
      actorModel: context.actorId ? "Admin" : undefined,
      payload: {
        landerId: landerId,
        landerName: lander.name,
        mode: context.mode || "auto",
        reason: context.reason,
      },
      createdAt: new Date(),
    });
    (query as any).activities = activities;

    // Adjust lander load
    await this.adjustLanderLoad(landerId, 1, context.session);
    if (
      previousLanderId &&
      previousLanderId.toString() !== landerId.toString()
    ) {
      await this.adjustLanderLoad(previousLanderId, -1, context.session);
    }

    return query;
  }
}

export default LanderAssignmentEngine;

