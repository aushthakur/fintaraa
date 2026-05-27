import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import {
  fetchSurepassCibilReport,
  fetchSurepassCibilPdfReport,
  prepareSurepassCibilPayload,
} from "../../services/surepass.service";
import { ConsentHistory } from "../../modals/consentHistory.model";
import { KycVerificationStatus, User } from "../../modals/user.model";
import { Agency } from "../../modals/agency.model";
import { BureauScoreHistory } from "../../modals/bureauScoreHistory.model";
import { rewardReferralIfEligible } from "../../services/referral.service";
import { fetchEncryptedCibilReport } from "../../services/surepassEncrypted.service";
import { sendSingleNotification } from "../../services/notification.service";
import { UserType } from "../../modals/notification.model";
import { RazorpayService } from "../../config/razorpay";

type ScoreBureau = "cibil" | "experian";

const SCORE_PRICING_INR: Record<ScoreBureau, number> = {
  cibil: 99,
  experian: 50,
};

const toNumber = (value: any) => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeBureau = (value: any): ScoreBureau | null => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["cibil", "cibil_score", "cibilscore"].includes(raw)) return "cibil";
  if (
    ["experian", "experian_score", "experianscore"].includes(raw)
  ) {
    return "experian";
  }
  return null;
};

const extractScore = (report: any) =>
  toNumber(
    report?.data?.credit_score ||
      report?.data?.score ||
      report?.data?.cibil_score ||
      report?.score ||
      report?.cibil_score,
  ) || 0;

const extractCreditReportLink = (report: any) =>
  report?.data?.credit_report_link ||
  report?.data?.creditReportLink ||
  report?.credit_report_link ||
  report?.creditReportLink ||
  report?.pdfUrl ||
  null;

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const toText = (value: any) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const normalizePanValue = (value: any) =>
  toText(value).replace(/\s+/g, "").toUpperCase();
const isValidPan = (value: string) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value);

const normalizePaymentDetails = (body: any) => ({
  orderId: toText(
    body?.payment?.orderId ||
      body?.paymentOrderId ||
      body?.orderId ||
      body?.razorpayOrderId,
  ),
  paymentId: toText(
    body?.payment?.paymentId ||
      body?.paymentId ||
      body?.razorpayPaymentId,
  ),
  signature: toText(
    body?.payment?.signature ||
      body?.paymentSignature ||
      body?.razorpaySignature,
  ),
  method: toText(body?.payment?.method || body?.paymentMethod),
});

const resolveHistoryActor = async (req: Request | any) => {
  const actorId = req.user?._id;
  const role = String(req.user?.role || "").toLowerCase();
  if (!actorId) throw new ApiError(401, "Unauthorized");

  if (role === "agency" || role === "agency_member") {
    const actor = await Agency.findById(actorId)
      .select("_id name email mobile role parentAgency")
      .lean();
    if (!actor) throw new ApiError(404, "Agency not found");

    const owner =
      role === "agency_member" && actor.parentAgency
        ? await Agency.findById(actor.parentAgency)
            .select("_id name")
            .lean()
        : actor;

    return {
      actor,
      owner,
      actorRole: role as "agency" | "agency_member",
      ownerRole: (owner?.role || role) as "agency" | "agency_member",
      actorId: String(actor._id),
      ownerId: String(owner?._id || actor._id),
    };
  }

  const user = await User.findById(actorId)
    .select("_id name email mobile role")
    .lean();
  if (!user) throw new ApiError(404, "User not found");

  return {
    actor: user,
    owner: user,
    actorRole: "user" as const,
    ownerRole: "user" as const,
    actorId: String(user._id),
    ownerId: String(user._id),
  };
};

const buildHistorySummary = (args: {
  bureau: ScoreBureau;
  customerName?: string;
  customerMobile?: string;
  customerPan?: string;
  bureauScore?: number | null;
}) => {
  const parts = [
    args.customerName ? `Name: ${args.customerName}` : null,
    args.customerMobile ? `Mobile: ${args.customerMobile}` : null,
    args.customerPan ? `PAN: ${args.customerPan}` : null,
    args.bureauScore ? `${args.bureau.toUpperCase()}: ${Math.round(args.bureauScore)}` : null,
  ].filter(Boolean);
  return parts.join(" | ");
};

const buildCustomerLookupContext = (body: any) => {
  const name = toText(
    body?.apiName ||
      body?.name ||
      body?.customerName ||
      body?.fullName ||
      body?.customer?.name ||
      body?.customer?.fullName,
  );
  const mobile = toText(
    body?.customerMobile ||
      body?.mobile ||
      body?.mobileNumber ||
      body?.registeredMobileNumber ||
      body?.customer?.mobile ||
      body?.customer?.mobileNumber,
  ).replace(/\D/g, "");
  const pan = normalizePanValue(
    body?.customerPan ||
      body?.pan ||
      body?.panNumber ||
      body?.panCard ||
      body?.customer?.pan ||
      body?.customer?.panNumber,
  );
  const gender = toText(body?.gender || body?.sex || "male");
  const consent = toText(body?.consent || "Y") || "Y";

  if (!name) {
    throw new ApiError(400, "Customer name is required for bureau search.");
  }
  if (!mobile) {
    throw new ApiError(400, "Customer mobile number is required for bureau search.");
  }
  if (!pan) {
    throw new ApiError(
      400,
      "Customer PAN is required for bureau search. Please enter a valid PAN.",
    );
  }
  if (!isValidPan(pan)) {
    throw new ApiError(
      400,
      "Customer PAN is invalid. Use the 10-character format like ABCDE1234F.",
    );
  }

  return { name, mobile, pan, gender, consent };
};

const fetchAndPersistCustomerBureauScore = async (args: {
  req: Request | any;
  bureau: ScoreBureau;
  payload: ReturnType<typeof prepareSurepassCibilPayload>;
  paymentVerified?: boolean;
  paymentAmount?: number;
  paymentOrderId?: string;
  paymentId?: string;
  paymentSignature?: string;
  paymentMethod?: string;
}) => {
  const cibilReport = await fetchSurepassCibilReport(args.payload);
  const cibilScore = extractScore(cibilReport.data);
  const pdfReport = await fetchSurepassCibilPdfReport(args.payload).catch(
    () => null,
  );
  const pdfLink =
    extractCreditReportLink(pdfReport?.data) ||
    extractCreditReportLink(cibilReport.data);
  const bureauScore =
    args.bureau === "experian"
      ? deriveExperianScore(
          `${args.payload.pan}:${args.payload.mobile}:${args.payload.name}`,
          cibilScore,
        )
      : cibilScore;
  const responsePayload: Record<string, any> = {
    bureau: args.bureau,
    payload: args.payload,
    cibilScore,
    bureauScore,
    report: cibilReport.data,
    pdfReport: pdfReport?.data || null,
    pdfUrl: pdfLink,
    paymentVerified: Boolean(args.paymentVerified),
    paymentAmount: args.paymentAmount,
  };

  if (args.bureau === "experian") {
    responsePayload.experianScore = bureauScore;
    responsePayload.note =
      "Experian score is indicative until the partner feed is connected.";
  }

  await recordBureauHistory({
    req: args.req,
    bureau: args.bureau,
    lookupSource: "customer_lookup",
    payload: args.payload,
    response: responsePayload,
    report: cibilReport.data,
    pdfUrl: pdfLink,
    customerName: args.payload.name,
    customerMobile: args.payload.mobile,
    customerPan: args.payload.pan,
    customerGender: args.payload.gender,
    paidAmount: args.paymentAmount,
    paymentStatus: args.paymentVerified ? "verified" : "waived",
    paymentOrderId: args.paymentOrderId,
    paymentId: args.paymentId,
    paymentSignature: args.paymentSignature,
    paymentMethod: args.paymentMethod,
    bureauScore,
    cibilScore,
    experianScore: args.bureau === "experian" ? bureauScore : undefined,
    note: responsePayload.note,
  });

  return responsePayload;
};

const recordBureauHistory = async (args: {
  req: Request | any;
  bureau: ScoreBureau;
  lookupSource: "customer_lookup" | "self_lookup" | "pdf_lookup";
  payload?: Record<string, any>;
  response?: Record<string, any>;
  report?: Record<string, any>;
  pdfUrl?: string | null;
  customerName?: string;
  customerMobile?: string;
  customerPan?: string;
  customerGender?: string;
  paidAmount?: number;
  paymentStatus?: "verified" | "waived" | "failed" | "pending";
  paymentOrderId?: string;
  paymentId?: string;
  paymentSignature?: string;
  paymentMethod?: string;
  bureauScore?: number;
  cibilScore?: number;
  experianScore?: number;
  note?: string;
}) => {
  try {
    const scope = await resolveHistoryActor(args.req);
    const now = new Date();
    await BureauScoreHistory.create({
      ownerId: scope.ownerId,
      ownerRole: scope.ownerRole,
      ownerName: toText(scope.owner?.name) || undefined,
      actorId: scope.actorId,
      actorRole: scope.actorRole,
      actorName: toText(scope.actor?.name) || undefined,
      actorEmail: toText(scope.actor?.email) || undefined,
      actorMobile: toText(scope.actor?.mobile) || undefined,
      bureau: args.bureau,
      lookupSource: args.lookupSource,
      customerName: toText(args.customerName) || undefined,
      customerMobile: toText(args.customerMobile) || undefined,
      customerPan: toText(args.customerPan) || undefined,
      customerGender: toText(args.customerGender) || undefined,
      paidAmount: args.paidAmount,
      currency: "INR",
      paymentStatus: args.paymentStatus || "verified",
      paymentOrderId: toText(args.paymentOrderId) || undefined,
      paymentId: toText(args.paymentId) || undefined,
      paymentSignature: toText(args.paymentSignature) || undefined,
      paymentMethod: toText(args.paymentMethod) || undefined,
      bureauScore: args.bureauScore,
      cibilScore: args.cibilScore,
      experianScore: args.experianScore,
      pdfUrl: args.pdfUrl || undefined,
      report: args.report || undefined,
      payload: args.payload || undefined,
      response: args.response || undefined,
      summary:
        buildHistorySummary({
          bureau: args.bureau,
          customerName: args.customerName,
          customerMobile: args.customerMobile,
          customerPan: args.customerPan,
          bureauScore: args.bureauScore || args.cibilScore || args.experianScore,
        }) || undefined,
      note: args.note,
      fetchedAt: now,
      expiresAt: addDays(now, 30),
    });
  } catch (error: any) {
    console.log(
      `[CIBIL History] Failed to record history: ${error?.message || error}`,
    );
  }
};

const buildCibilPayloadFromActor = (actor: any) => {
  const kycPersonal = actor?.kycProfile?.personalDetails || {};
  return prepareSurepassCibilPayload({
    mobile: actor?.mobile,
    panCard: actor?.panCard || kycPersonal?.panNumber,
    name: actor?.name || kycPersonal?.fullName,
    consent: "Y",
    gender:
      String(actor?.gender || kycPersonal?.gender || "male").toLowerCase() ===
      "female"
        ? "female"
        : "male",
  });
};

const getActorScoreWallet = (actor: any) => ({
  cibilCredits: toNumber(actor?.cibilScoreCheckCredits),
  experianCredits: toNumber(actor?.experianScoreCheckCredits),
});

const setActorScoreWallet = (
  actor: any,
  next: { cibilCredits: number; experianCredits: number },
) => {
  actor.cibilScoreCheckCredits = Math.max(0, toNumber(next.cibilCredits));
  actor.experianScoreCheckCredits = Math.max(0, toNumber(next.experianCredits));
};

const deriveExperianScore = (seed: string, cibilScore?: number) => {
  const base = toNumber(cibilScore) > 0 ? toNumber(cibilScore) : 700;
  let hash = 0;
  for (const char of String(seed || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  }
  const offset = (hash % 61) - 30;
  return Math.max(300, Math.min(900, base + offset));
};

const resolveActorForPaidScore = async (req: Request | any) => {
  const actorId = req.user?._id;
  const role = String(req.user?.role || "").toLowerCase();
  if (!actorId) throw new ApiError(401, "Unauthorized");

  if (role === "agency" || role === "agency_member") {
    const agency = await Agency.findById(actorId);
    if (!agency) throw new ApiError(404, "Agency not found");
    return { actor: agency, actorType: "agency" as const };
  }

  const user = await User.findById(actorId);
  if (user) return { actor: user, actorType: "user" as const };

  const agency = await Agency.findById(actorId);
  if (agency) return { actor: agency, actorType: "agency" as const };

  throw new ApiError(404, "Account not found");
};

export const getCreditScorePricing = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          currency: "INR",
          plans: {
            cibil: {
              bureau: "cibil",
              amount: SCORE_PRICING_INR.cibil,
              label: "CIBIL Score",
            },
            experian: {
              bureau: "experian",
              amount: SCORE_PRICING_INR.experian,
              label: "Experian Score",
            },
          },
          notes: {
            cibil: [
              "Verified payment unlocks a live bureau pull.",
              "PDF is attached to the fetched report when available.",
              "History is retained for 30 days for the signed-in agency.",
            ],
            experian: [
              "Experian is fetched from the same lookup flow and priced separately.",
              "Price includes the bureau pull and report PDF when available.",
              "History is retained for 30 days for the signed-in agency.",
            ],
          },
          terms: [
            "Consent is mandatory before fetching any bureau data.",
            "The customer PAN and mobile must match the bureau payload.",
            "Payments are non-refundable once the bureau request is sent.",
          ],
        },
        "Credit score pricing fetched successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const getCreditScoreWallet = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { actor, actorType } = await resolveActorForPaidScore(req);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          actorType,
          wallet: getActorScoreWallet(actor),
          pricing: SCORE_PRICING_INR,
        },
        "Credit score wallet fetched successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const createBureauScorePaymentOrder = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const scope = await resolveHistoryActor(req);
    const bureau = normalizeBureau(req.body?.bureau) || "cibil";
    const amount = SCORE_PRICING_INR[bureau];
    const transactionId = `bureau_${bureau}_${Date.now()}`;
    const order = await RazorpayService.createOrder(amount, transactionId, {
      userId: scope.actorId,
      userName: scope.actor?.name || scope.actor?.email || scope.actorId,
    });

    if (!order.success) {
      throw new ApiError(500, order.message || "Failed to create payment order");
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          bureau,
          amount,
          currency: "INR",
          transactionId,
          keyId: order.data?.keyId,
          orderId: order.data?.orderId,
          notes: {
            bureau,
            customerName: scope.actor?.name || "",
            customerMobile: scope.actor?.mobile || "",
          },
        },
        "Payment order created successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const verifyBureauPaymentAndFetch = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const bureau = normalizeBureau(req.body?.bureau) || "cibil";
    const payment = normalizePaymentDetails(req.body);
    if (!payment.orderId || !payment.paymentId || !payment.signature) {
      throw new ApiError(
        400,
        "Payment verification details are required to fetch the bureau score",
      );
    }

    const verified = RazorpayService.verifyPaymentSignature(
      payment.orderId,
      payment.paymentId,
      payment.signature,
    );

    if (!verified) {
      throw new ApiError(400, "Razorpay payment verification failed");
    }

    const customer = buildCustomerLookupContext(req.body);
    const payload = prepareSurepassCibilPayload({
      name: customer.name,
      mobile: customer.mobile,
      pan: customer.pan,
      gender: customer.gender as "male" | "female",
      consent: customer.consent,
    });

    const responsePayload = await fetchAndPersistCustomerBureauScore({
      req,
      bureau,
      payload,
      paymentVerified: true,
      paymentAmount: SCORE_PRICING_INR[bureau],
      paymentOrderId: payment.orderId,
      paymentId: payment.paymentId,
      paymentSignature: payment.signature,
      paymentMethod: payment.method || undefined,
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          ...responsePayload,
          paymentVerified: true,
          paymentOrderId: payment.orderId,
          paymentId: payment.paymentId,
          paymentMethod: payment.method || undefined,
        },
        "Customer bureau score fetched successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const purchaseCreditScoreCheck = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { actor, actorType } = await resolveActorForPaidScore(req);
    const bureau = normalizeBureau(req.body?.bureau);
    if (!bureau) {
      throw new ApiError(400, "bureau must be either 'cibil' or 'experian'");
    }

    const quantity = Math.max(1, Math.floor(toNumber(req.body?.quantity) || 1));
    const expectedAmount = SCORE_PRICING_INR[bureau] * quantity;
    const paidAmount = toNumber(req.body?.paidAmount ?? req.body?.amount);
    if (paidAmount > 0 && paidAmount < expectedAmount) {
      throw new ApiError(
        400,
        `Paid amount is less than required amount ₹${expectedAmount}`,
      );
    }

    const wallet = getActorScoreWallet(actor);
    if (bureau === "cibil") wallet.cibilCredits += quantity;
    else wallet.experianCredits += quantity;
    setActorScoreWallet(actor, wallet);
    actor.lastScorePurchaseAt = new Date();
    await actor.save();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          actorType,
          bureau,
          quantity,
          pricing: SCORE_PRICING_INR[bureau],
          expectedAmount,
          wallet,
          purchasedAt: actor.lastScorePurchaseAt,
        },
        "Credit score check purchased successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchPaidCreditScore = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { actor, actorType } = await resolveActorForPaidScore(req);
    const bureau = normalizeBureau(req.body?.bureau);
    const forceRefresh = Boolean(req.body?.forceRefresh);

    if (!bureau) {
      throw new ApiError(400, "bureau must be either 'cibil' or 'experian'");
    }

    const wallet = getActorScoreWallet(actor);
    const hasCredit =
      bureau === "cibil" ? wallet.cibilCredits > 0 : wallet.experianCredits > 0;

    if (bureau === "cibil") {
      const cachedScore = toNumber(actor?.cibilScore);
      const cachedReport = actor?.cibilReport || null;
      if (!forceRefresh && cachedScore > 0 && cachedReport) {
        await recordBureauHistory({
          req,
          bureau,
          lookupSource: "self_lookup",
          response: {
            actorType,
            bureau,
            cached: true,
            cibilScore: cachedScore,
            report: cachedReport,
            lastFetchedAt: actor?.cibilLastFetchedAt,
            wallet,
          },
          report: cachedReport,
          customerName: actor?.name,
          customerMobile: actor?.mobile,
          customerPan: (actor as any)?.panCard,
          customerGender: actor?.gender,
          paymentStatus: "waived",
          bureauScore: cachedScore,
          cibilScore: cachedScore,
        });
        return res.status(200).json(
          new ApiResponse(
            200,
            {
              actorType,
              bureau,
              cached: true,
              cibilScore: cachedScore,
              report: cachedReport,
              lastFetchedAt: actor?.cibilLastFetchedAt,
              wallet,
            },
            "CIBIL score fetched successfully",
          ),
        );
      }

      if (!hasCredit) {
        throw new ApiError(
          402,
          `Insufficient ${bureau.toUpperCase()} credits. Please purchase first.`,
        );
      }

      const payload = buildCibilPayloadFromActor(actor);
      const report = await fetchSurepassCibilReport(payload);
      const score = extractScore(report.data);

      actor.cibilScore = score || actor.cibilScore;
      actor.cibilLastFetchedAt = new Date();
      actor.cibilReport = report.data;
      actor.cibilRequestPayload = payload;

      if (bureau === "cibil") wallet.cibilCredits -= 1;
      setActorScoreWallet(actor, wallet);
      await actor.save();
      await recordBureauHistory({
        req,
        bureau,
        lookupSource: "self_lookup",
        payload,
        response: {
          actorType,
          bureau,
          cached: false,
          cibilScore: score || null,
          report: report.data,
          lastFetchedAt: actor?.cibilLastFetchedAt,
          wallet,
        },
        report: report.data,
        customerName: actor?.name,
        customerMobile: actor?.mobile,
        customerPan: (actor as any)?.panCard,
        customerGender: actor?.gender,
        paymentStatus: "verified",
        bureauScore: score || undefined,
        cibilScore: score || undefined,
      });

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            actorType,
            bureau,
            cached: false,
            cibilScore: score || null,
            report: report.data,
            lastFetchedAt: actor?.cibilLastFetchedAt,
            wallet,
          },
          "CIBIL score fetched successfully",
        ),
      );
    }

    const cachedScore = toNumber(actor?.experianScore);
    const cachedReport = actor?.experianReport || null;
    if (!forceRefresh && cachedScore > 0 && cachedReport) {
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            actorType,
            bureau,
            cached: true,
            experianScore: cachedScore,
            report: cachedReport,
            lastFetchedAt: actor?.experianLastFetchedAt,
            wallet,
          },
          "Experian score fetched successfully",
        ),
      );
    }

    if (!hasCredit) {
      throw new ApiError(
        402,
        `Insufficient ${bureau.toUpperCase()} credits. Please purchase first.`,
      );
    }

    const derivedScore = deriveExperianScore(
      String(actor?._id || ""),
      toNumber(actor?.cibilScore),
    );
    const report = {
      source: "derived_from_cibil",
      generatedAt: new Date().toISOString(),
      score: derivedScore,
      note: "Experian partner integration pending. Generated score is indicative.",
    };

    actor.experianScore = derivedScore;
    actor.experianReport = report;
    actor.experianLastFetchedAt = new Date();
    wallet.experianCredits -= 1;
    setActorScoreWallet(actor, wallet);
    await actor.save();
    await recordBureauHistory({
      req,
      bureau,
      lookupSource: "self_lookup",
      response: {
        actorType,
        bureau,
        cached: false,
        experianScore: derivedScore,
        report,
        lastFetchedAt: actor?.experianLastFetchedAt,
        wallet,
      },
      report,
      customerName: actor?.name,
      customerMobile: actor?.mobile,
      customerPan: (actor as any)?.panCard,
      customerGender: actor?.gender,
      paymentStatus: "verified",
      bureauScore: derivedScore,
      experianScore: derivedScore,
      note: report.note,
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          actorType,
          bureau,
          cached: false,
          experianScore: derivedScore,
          report,
          lastFetchedAt: actor?.experianLastFetchedAt,
          wallet,
        },
        "Experian score fetched successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchCibilReport = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const payload = prepareSurepassCibilPayload(req.body);
    const requestedEnv =
      (req.query?.environment as string)?.toLowerCase() ||
      (req.body?.environment as string)?.toLowerCase();

    const normalizedEnv =
      requestedEnv === "production"
        ? "production"
        : requestedEnv === "sandbox"
          ? "sandbox"
          : undefined;

    const report = await fetchSurepassCibilReport(payload, {
      environment: normalizedEnv,
    });

    const score =
      report.data?.score ||
      report.data?.cibil_score ||
      report.data?.data?.score ||
      null;

    return res.status(200).json(
      new ApiResponse(200, {
        payload,
        environment: report.environment,
        report: report.data,
        ...(score ? { cibilScore: score } : {}),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchCibilPdfReport = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) {
      return next(new ApiError(401, "Unauthorized"));
    }

    const payload = prepareSurepassCibilPayload(req.body);
    const requestedEnv =
      (req.query?.environment as string)?.toLowerCase() ||
      (req.body?.environment as string)?.toLowerCase();

    const normalizedEnv =
      requestedEnv === "production"
        ? "production"
        : requestedEnv === "sandbox"
          ? "sandbox"
          : undefined;

    const report = await fetchSurepassCibilPdfReport(payload, {
      environment: normalizedEnv,
    });

    const pdfUrl =
      report.data?.data?.credit_report_link ||
      report.data?.data?.creditReportLink ||
      report.data?.credit_report_link ||
      report.data?.creditReportLink ||
      null;

    await recordBureauHistory({
      req,
      bureau: "cibil",
      lookupSource: "pdf_lookup",
      payload,
      response: { report: report.data, payload },
      report: report.data,
      customerName: payload.name,
      customerMobile: payload.mobile,
      customerPan: payload.pan,
      customerGender: payload.gender,
      paymentStatus: "waived",
      pdfUrl,
    });

    return res.status(200).json(
      new ApiResponse(200, {
        payload,
        cached: false,
        report: report.data,
        pdfUrl,
        environment: report.environment,
        lastFetchedAt: new Date(),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchCibilReportWithMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { cibilReport, cibilScore, cibilEnvironment, cibilRequestPayload } =
      req.body;
    if (!cibilReport) {
      throw new ApiError(
        500,
        "CIBIL report is unavailable after middleware execution",
      );
    }

    return res.status(200).json(
      new ApiResponse(200, {
        payload: cibilRequestPayload,
        environment: cibilEnvironment,
        report: cibilReport,
        ...(cibilScore ? { cibilScore } : {}),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchEncryptedCibilReportController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await fetchEncryptedCibilReport(req.body);
    const encryptedScore =
      result.response?.score ||
      result.response?.cibil_score ||
      result.response?.data?.score ||
      null;

    return res.status(200).json(
      new ApiResponse(200, {
        payload: result.payload,
        environment: "encrypted",
        report: result.response,
        ...(encryptedScore ? { cibilScore: encryptedScore } : {}),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

export const searchCustomerCreditScore = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const bureau = normalizeBureau(req.body?.bureau) || "cibil";
    const expectedAmount = SCORE_PRICING_INR[bureau];
    const paidAmount = toNumber(req.body?.paidAmount ?? req.body?.amount);
    const paymentReference = toText(
      req.body?.paymentReference || req.body?.paymentId || req.body?.transactionId,
    );
    const shouldVerifyPayment =
      paidAmount > 0 || paymentReference.length > 0 || req.body?.requirePayment === true;
    if (shouldVerifyPayment && paidAmount < expectedAmount) {
      throw new ApiError(
        400,
        `Payment verification failed. Please pay ₹${expectedAmount} for ${bureau.toUpperCase()} before fetching the report.`,
      );
    }

    const customer = buildCustomerLookupContext(req.body);

    const payload = prepareSurepassCibilPayload({
      name: customer.name,
      mobile: customer.mobile,
      pan: customer.pan,
      gender: customer.gender as any,
      consent: customer.consent,
    });

    const responsePayload = await fetchAndPersistCustomerBureauScore({
      req,
      bureau,
      payload,
      paymentVerified: shouldVerifyPayment,
      paymentAmount: shouldVerifyPayment ? paidAmount || expectedAmount : undefined,
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        responsePayload,
        "Customer bureau score fetched successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const getBureauScoreHistory = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const scope = await resolveHistoryActor(req);
    const page = Math.max(Number(req.query?.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 100);
    const bureau = normalizeBureau(req.query?.bureau);
    const search = toText(req.query?.search);
    const agentId = toText(req.query?.agentId);
    const fromRaw = req.query?.from || req.query?.dateFrom;
    const toRaw = req.query?.to || req.query?.dateTo;

    const now = new Date();
    const defaultFrom = addDays(now, -30);
    const from = fromRaw ? new Date(String(fromRaw)) : defaultFrom;
    const to = toRaw ? new Date(String(toRaw)) : now;

    const query: Record<string, any> = {
      ownerId: scope.ownerId,
      fetchedAt: {
        $gte: Number.isNaN(from.getTime()) ? defaultFrom : from,
        $lte: Number.isNaN(to.getTime()) ? now : to,
      },
    };

    if (bureau) query.bureau = bureau;
    if (agentId) query.actorId = agentId;

    if (search) {
      query.$or = [
        { customerName: { $regex: search, $options: "i" } },
        { customerMobile: { $regex: search, $options: "i" } },
        { customerPan: { $regex: search, $options: "i" } },
        { actorName: { $regex: search, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      BureauScoreHistory.find(query)
        .sort({ fetchedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      BureauScoreHistory.countDocuments(query),
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          result: items,
          pagination: {
            currentPage: page,
            itemsPerPage: limit,
            totalItems: total,
            totalPages: Math.ceil(total / limit),
          },
          filters: {
            bureau: bureau || null,
            search: search || null,
            from: (Number.isNaN(from.getTime()) ? defaultFrom : from).toISOString(),
            to: (Number.isNaN(to.getTime()) ? now : to).toISOString(),
            agentId: agentId || null,
          },
        },
        "Bureau score history fetched successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchUserCibilReport = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { forceRefresh = false } = req.body || {};
    const userId = req.user?._id;

    if (!userId) {
      return next(new ApiError(401, "Unauthorized"));
    }

    const user = await User.findById(userId);
    if (!user) return next(new ApiError(404, "User not found"));
    const lastConsent = await ConsentHistory.findOne({
      user: userId,
      type: "cibil",
    })
      .sort({ collectedAt: -1 })
      .lean();

    const now = new Date();
    const lastFetched = user.cibilLastFetchedAt
      ? new Date(user.cibilLastFetchedAt)
      : null;
    const msDiff = lastFetched ? now.getTime() - lastFetched.getTime() : null;
    const daysSinceFetch = msDiff ? msDiff / (1000 * 60 * 60 * 24) : null;
    const refreshLocked = daysSinceFetch !== null && daysSinceFetch < 30;
    const daysRemaining = Math.max(0, Math.ceil(30 - (daysSinceFetch || 0)));
    const cachedReport = (user as any)?.cibilReport || null;
    const cachedScoreExists =
      (user as any)?.cibilReport?.data?.credit_score || null;
    const cachedPayload = (user as any)?.cibilRequestPayload || null;

    if (!forceRefresh && cachedScoreExists && refreshLocked) {
      return res.status(200).json(
        new ApiResponse(200, {
          cached: true,
          report: cachedReport,
          payload: cachedPayload,
          cibilScore: user.cibilScore,
          refreshAvailableInDays: daysRemaining,
          lastFetchedAt: user.cibilLastFetchedAt,
          lastConsentAt: lastConsent?.collectedAt,
          message: `CIBIL can be refreshed again in ${daysRemaining} day(s).`,
        }),
      );
    }

    if (forceRefresh && refreshLocked) {
      return res.status(200).json(
        new ApiResponse(200, {
          cached: true,
          report: cachedReport,
          payload: cachedPayload,
          cibilScore: user.cibilScore || null,
          refreshAvailableInDays: daysRemaining,
          lastFetchedAt: user.cibilLastFetchedAt,
          lastConsentAt: lastConsent?.collectedAt,
          message: `CIBIL can be refreshed again in ${daysRemaining} day(s).`,
        }),
      );
    }

    const payload = prepareSurepassCibilPayload({
      mobile: user.mobile,
      panCard: user.panCard,
      name: user.name,
      consent: "Y",
      gender:
        String(user.gender || "male").toLowerCase() === "female"
          ? "female"
          : "male",
    });

    const report = await fetchSurepassCibilReport(payload);
    const score = report.data?.data?.credit_score || 0;

    user.cibilScore = score || user.cibilScore;
    user.cibilLastFetchedAt = now;
    (user as any).cibilReport = report.data;
    (user as any).cibilRequestPayload = payload;
    if (score) {
      user.kycProfile = user.kycProfile || { reusableAcrossApplications: true };
      user.kycProfile.verification = {
        ...(user.kycProfile.verification || {}),
        status: KycVerificationStatus.VERIFIED,
        verifiedAt: new Date(),
      };
    }
    await user.save();
    await recordBureauHistory({
      req,
      bureau: "cibil",
      lookupSource: "self_lookup",
      payload,
      response: { report: report.data, payload },
      report: report.data,
      customerName: user.name,
      customerMobile: user.mobile,
      customerPan: user.panCard,
      customerGender: user.gender,
      paymentStatus: "waived",
      bureauScore: score || undefined,
      cibilScore: score || undefined,
    });
    if (score) {
      await ConsentHistory.create({
        user: userId,
        type: "cibil",
        channel: "app",
        status: "granted",
        partner: "surepass",
        purpose: "credit_report",
        scope: ["cibil_score", "credit_report"],
        collectedAt: now,
        metadata: {
          score,
          environment: report.environment,
        },
      });
      await rewardReferralIfEligible(userId);
      try {
        await sendSingleNotification({
          type: "kyc-verified",
          toUserId: userId,
          toRole: UserType.USER,
          fromUser: { _id: userId, role: UserType.USER },
          context: {},
        });
      } catch (error: any) {
        console.log(
          `[Notification] Failed to send kyc-verified: ${
            error?.message || error
          }`,
        );
      }
    }
    try {
      await sendSingleNotification({
        type: "cibil-fetched",
        toUserId: userId,
        toRole: UserType.USER,
        fromUser: { _id: userId, role: UserType.USER },
        context: { score: score || "" },
      });
    } catch (error: any) {
      console.log(
        `[Notification] Failed to send cibil-fetched: ${
          error?.message || error
        }`,
      );
    }
    return res.status(200).json(
      new ApiResponse(200, {
        cached: false,
        payload,
        report: report.data,
        environment: report.environment,
        refreshAvailableInDays: daysRemaining,
        lastFetchedAt: user.cibilLastFetchedAt,
        lastConsentAt: now,
        message: `CIBIL can be refreshed again in ${daysRemaining} day(s).`,
        ...(score ? { cibilScore: score } : {}),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchUserCibilPdfReport = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;
    if (!userId) return next(new ApiError(401, "Unauthorized"));

    const user = await User.findById(userId);
    if (!user) return next(new ApiError(404, "User not found"));

    const now = new Date();
    const lastFetched = user.cibilPdfLastFetchedAt
      ? new Date(user.cibilPdfLastFetchedAt)
      : null;
    const msDiff = lastFetched ? now.getTime() - lastFetched.getTime() : null;
    const daysSinceFetch = msDiff ? msDiff / (1000 * 60 * 60 * 24) : null;
    const refreshLocked = daysSinceFetch !== null && daysSinceFetch < 30;
    const daysRemaining = Math.max(0, Math.ceil(30 - (daysSinceFetch || 0)));
    const cachedReport = (user as any)?.cibilPdfReport || null;
    const cachedLink =
      cachedReport?.data?.credit_report_link ||
      cachedReport?.data?.creditReportLink ||
      cachedReport?.credit_report_link ||
      cachedReport?.creditReportLink ||
      null;

    if (refreshLocked && cachedLink) {
      return res.status(200).json(
        new ApiResponse(200, {
          cached: true,
          report: cachedReport,
          refreshAvailableInDays: daysRemaining,
          lastFetchedAt: user.cibilPdfLastFetchedAt,
          message: `CIBIL PDF can be refreshed again in ${daysRemaining} day(s).`,
        }),
      );
    }

    const payload = prepareSurepassCibilPayload({
      name: user.name,
      mobile: user.mobile,
      panCard: user.panCard,
      consent: "Y",
      gender:
        String(user.gender || "male").toLowerCase() === "female"
          ? "female"
          : "male",
    });

    const normalizedEnv = "production";
    const report = await fetchSurepassCibilPdfReport(payload, {
      environment: normalizedEnv,
    });

    user.cibilPdfLastFetchedAt = now;
    (user as any).cibilPdfReport = report.data;
    await user.save();
    await recordBureauHistory({
      req,
      bureau: "cibil",
      lookupSource: "pdf_lookup",
      payload,
      response: { report: report.data, payload },
      report: report.data,
      customerName: user.name,
      customerMobile: user.mobile,
      customerPan: user.panCard,
      customerGender: user.gender,
      paymentStatus: "waived",
      pdfUrl:
        report.data?.credit_report_link ||
        report.data?.creditReportLink ||
        null,
    });

    return res.status(200).json(
      new ApiResponse(200, {
        payload,
        cached: false,
        report: report.data,
        environment: report.environment,
        refreshAvailableInDays: daysRemaining,
        lastFetchedAt: user.cibilPdfLastFetchedAt,
        message: `CIBIL PDF can be refreshed again in ${daysRemaining} day(s).`,
      }),
    );
  } catch (error) {
    return next(error);
  }
};
