import { ClientSession, Types } from "mongoose";
import Admin from "../modals/admin.model";
import Role from "../modals/role.model";
import {
  ILoanQuery,
  LoanQueryActivityType,
  LoanType,
} from "../modals/loanquery.model";
import {
  IInsuranceQuery,
  InsuranceQueryActivityType,
  InsuranceType,
} from "../modals/insurancequery.model";

type AssignableQuery = ILoanQuery | IInsuranceQuery;

type AssignmentContext = {
  actorId?: string;
  actorModel?: "Admin" | "User" | "Lander";
  reason: string;
  session?: ClientSession;
};

type AssignmentCandidate = {
  _id: Types.ObjectId;
  username?: string;
  name?: string;
  email: string;
  leadCapacity?: number;
  activeLeads?: number;
  serviceablePincodes?: string[];
  productFocusLoan?: LoanType[];
  productFocusInsurance?: InsuranceType[];
  lastLeadAssignedAt?: Date;
  createdAt?: Date;
};

const normalize = (value?: string) => String(value || "").trim().toLowerCase();

const hasPincodeMatch = (targetPincode?: string, serviceablePincodes?: string[]) => {
  if (!serviceablePincodes || serviceablePincodes.length === 0) return true;
  const normalizedTarget = normalize(targetPincode);
  if (!normalizedTarget) return false;
  return serviceablePincodes.some((value) => {
    const entry = normalize(value);
    if (!entry) return false;
    return normalizedTarget === entry || normalizedTarget.startsWith(entry) || entry.startsWith(normalizedTarget);
  });
};

const hasProductMatch = (
  loanType: LoanType | undefined,
  insuranceType: InsuranceType | undefined,
  candidate: AssignmentCandidate,
) => {
  if (loanType) {
    const focus = (candidate.productFocusLoan || []).map(normalize).filter(Boolean);
    return focus.length === 0 || focus.includes(normalize(loanType));
  }
  if (insuranceType) {
    const focus = (candidate.productFocusInsurance || []).map(normalize).filter(Boolean);
    return focus.length === 0 || focus.includes(normalize(insuranceType));
  }
  return true;
};

const sortCandidates = (
  candidates: AssignmentCandidate[],
  pincode?: string,
  loanType?: LoanType,
  insuranceType?: InsuranceType,
) => {
  return candidates.sort((a, b) => {
    const aPincodeScore = hasPincodeMatch(pincode, a.serviceablePincodes) ? 0 : 1;
    const bPincodeScore = hasPincodeMatch(pincode, b.serviceablePincodes) ? 0 : 1;
    if (aPincodeScore !== bPincodeScore) return aPincodeScore - bPincodeScore;

    const aProductScore = hasProductMatch(loanType, insuranceType, a) ? 0 : 1;
    const bProductScore = hasProductMatch(loanType, insuranceType, b) ? 0 : 1;
    if (aProductScore !== bProductScore) return aProductScore - bProductScore;

    const aCapacity = Math.max(1, a.leadCapacity || 40);
    const bCapacity = Math.max(1, b.leadCapacity || 40);
    const aLoad = (a.activeLeads || 0) / aCapacity;
    const bLoad = (b.activeLeads || 0) / bCapacity;
    if (aLoad !== bLoad) return aLoad - bLoad;

    const aActive = a.activeLeads || 0;
    const bActive = b.activeLeads || 0;
    if (aActive !== bActive) return aActive - bActive;

    const aTime = a.lastLeadAssignedAt ? new Date(a.lastLeadAssignedAt).getTime() : 0;
    const bTime = b.lastLeadAssignedAt ? new Date(b.lastLeadAssignedAt).getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;

    const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aCreated - bCreated;
  });
};

class EmployeeAssignmentEngine {
  static async adjustEmployeeLoad(
    adminId: Types.ObjectId | string,
    delta: number,
    session?: ClientSession,
  ) {
    if (!adminId || !delta) return;

    if (delta < 0) {
      const employee = await Admin.findById(adminId).session(session || null);
      if (!employee) return;
      const next = Math.max(0, (employee.activeLeads || 0) + delta);
      await Admin.updateOne(
        { _id: adminId },
        { $set: { activeLeads: next } },
        { session },
      );
      return;
    }

    await Admin.updateOne(
      { _id: adminId },
      {
        $inc: { activeLeads: delta },
        $set: { lastLeadAssignedAt: new Date() },
      },
      { session },
    );
  }

  static async ensureAssignmentForLoanQuery(
    query: ILoanQuery,
    context: AssignmentContext,
  ) {
    if (query.assignedAgent) return query;
    const best = await this.findBestEmployee(query.pincode, query.loanType, undefined, context.session);
    if (!best) return query;

    query.assignedAgent = new Types.ObjectId(String(best._id));
    query.activities = query.activities || [];
    query.activities.push({
      type: LoanQueryActivityType.AGENT_ASSIGNED,
      description: `Employee assigned: ${best.name || best.username || best.email}`,
      actor: context.actorId ? new Types.ObjectId(String(context.actorId)) : undefined,
      actorModel: context.actorModel || "Admin",
      payload: {
        assignedEmployeeId: String(best._id),
        assignedEmployeeName: best.name || best.username || best.email,
        mode: "auto",
        reason: context.reason,
      },
      createdAt: new Date(),
    });

    await this.adjustEmployeeLoad(best._id, 1, context.session);
    return query;
  }

  static async ensureAssignmentForInsuranceQuery(
    query: IInsuranceQuery,
    context: AssignmentContext,
  ) {
    if (query.assignedAgent) return query;
    const best = await this.findBestEmployee(
      query.pincode,
      undefined,
      query.typeOfInsurance,
      context.session,
    );
    if (!best) return query;

    query.assignedAgent = new Types.ObjectId(String(best._id));
    query.activities = query.activities || [];
    query.activities.push({
      type: InsuranceQueryActivityType.AGENT_ASSIGNED,
      description: `Employee assigned: ${best.name || best.username || best.email}`,
      actor: context.actorId ? new Types.ObjectId(String(context.actorId)) : undefined,
      actorModel: context.actorModel || "Admin",
      payload: {
        assignedEmployeeId: String(best._id),
        assignedEmployeeName: best.name || best.username || best.email,
        mode: "auto",
        reason: context.reason,
      },
      createdAt: new Date(),
    });

    await this.adjustEmployeeLoad(best._id, 1, context.session);
    return query;
  }

  private static async findBestEmployee(
    pincode?: string,
    loanType?: LoanType,
    insuranceType?: InsuranceType,
    session?: ClientSession,
  ): Promise<AssignmentCandidate | null> {
    const role = await Role.findOne({ name: "agent" }).select("_id").lean();
    if (!role?._id) return null;

    const candidates = (await Admin.find({
      role: role._id,
      status: true,
      availability: true,
      leadAutoAssign: { $ne: false },
    })
      .select(
        "_id username name email leadCapacity activeLeads serviceablePincodes productFocusLoan productFocusInsurance lastLeadAssignedAt createdAt",
      )
      .session(session || null)
      .lean()) as AssignmentCandidate[];

    if (!candidates.length) return null;

    const eligible = candidates.filter((candidate) => {
      const capacity = Math.max(1, candidate.leadCapacity || 40);
      if ((candidate.activeLeads || 0) >= capacity) return false;
      if (!hasProductMatch(loanType, insuranceType, candidate)) return false;
      return hasPincodeMatch(pincode, candidate.serviceablePincodes);
    });

    if (!eligible.length) return null;
    return sortCandidates(eligible, pincode, loanType, insuranceType)[0] || null;
  }
}

export default EmployeeAssignmentEngine;
