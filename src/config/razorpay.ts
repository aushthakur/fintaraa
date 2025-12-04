import https from "https";
import crypto from "crypto";
import Razorpay from "razorpay";
import { config } from "./config";

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

type AutoPayChargeOptions = {
  customerId: string;
  amount: number;
  currency?: string;
  tokenId?: string;
  receipt?: string;
  notes?: Record<string, string>;
};

type AutoPayStatusResponse = {
  success: boolean;
  enabled: boolean;
  tokenId: string | null;
  message?: string;
};

export class RazorpayService {
  private static razorpay: any = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
  });

  private static async razorpayXRequest<T>(
    path: string,
    body: Record<string, any>,
    method: string = "POST"
  ): Promise<T> {
    const credentials = config.payment?.razorpayX;
    if (!credentials?.keyId || !credentials?.keySecret) {
      throw new Error("RazorpayX credentials are not configured");
    }

    const payload = JSON.stringify(body);

    return await new Promise<T>((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.razorpay.com",
          path,
          method,
          auth: `${credentials.keyId}:${credentials.keySecret}`,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              try {
                resolve(JSON.parse(data));
              } catch (err) {
                reject(err);
              }
            } else {
              reject(
                new Error(
                  `RazorpayX request failed (${res.statusCode}): ${data}`
                )
              );
            }
          });
        }
      );

      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }

  /**
   * Create Razorpay order
   */
  static async createOrder(
    amount: number,
    transactionId: string,
    userDetails: any
  ) {
    try {
      const options = {
        amount: Math.round(amount * 100), // Convert to paise
        currency: "INR",
        receipt: `txn_${transactionId}`,
        notes: {
          transactionId,
          userId: userDetails.userId,
          userName: userDetails.userName,
        },
      };

      const order: any = await this.razorpay.orders.create(options);

      return {
        success: true,
        data: {
          orderId: order.id,
          keyId: RAZORPAY_KEY_ID,
          currency: order.currency,
          amount: order.amount / 100,
        },
      };
    } catch (error: any) {
      console.log("Razorpay order creation failed:", error);
      return {
        success: false,
        message: error.message || "Failed to create order",
      };
    }
  }

  /**
   * Verify Razorpay payment signature
   */
  static verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature: string
  ): boolean {
    try {
      const text = `${orderId}|${paymentId}`;
      const generatedSignature = crypto
        .createHmac("sha256", RAZORPAY_KEY_SECRET)
        .update(text)
        .digest("hex");

      return generatedSignature === signature;
    } catch (error) {
      console.log("Signature verification failed:", error);
      return false;
    }
  }

  /**
   * Locate an active recurring token for autopay
   */
  private static pickActiveAutoPayToken(tokensResponse: any): any | null {
    const tokens = tokensResponse?.items || [];
    if (!Array.isArray(tokens) || tokens.length === 0) return null;

    return (
      tokens.find((token: any) => {
        if (!token) return false;
        const isRecurring =
          token?.recurring === true ||
          token?.recurring_details ||
          token?.method === "emandate" ||
          token?.method === "upi";
        const status =
          token?.status ||
          token?.recurring_details?.status ||
          token?.recurring_details?.entity_status;
        const isStatusActive = ["active", "confirmed", "authorised"].includes(
          (status || "").toLowerCase()
        );
        return isRecurring && isStatusActive;
      }) || null
    );
  }

  /**
   * Check if the customer has autopay enabled (active recurring token)
   */
  static async isAutoPayEnabled(
    customerId: string
  ): Promise<AutoPayStatusResponse> {
    try {
      const tokensResponse = await this.razorpay.customers.fetchTokens(
        customerId
      );
      const activeToken = this.pickActiveAutoPayToken(tokensResponse);

      return {
        success: true,
        enabled: Boolean(activeToken),
        tokenId: activeToken?.id ?? null,
      };
    } catch (error: any) {
      console.log("Autopay status check failed:", error);
      return {
        success: false,
        enabled: false,
        tokenId: null,
        message: error.message || "Failed to check autopay status",
      };
    }
  }

  /**
   * Charge customer using Razorpay Autopay (recurring payment)
   */
  static async chargeAutoPay({
    customerId,
    amount,
    currency = "INR",
    tokenId,
    receipt,
    notes = {},
  }: AutoPayChargeOptions) {
    try {
      let activeToken = tokenId;

      if (!activeToken) {
        const status = await this.isAutoPayEnabled(customerId);
        if (!status.success)
          return {
            success: false,
            message: status.message || "Unable to verify autopay status",
          };
        if (!status.enabled || !status.tokenId)
          return {
            success: false,
            message: "Autopay is not enabled for this customer",
          };
        activeToken = status.tokenId;
      }

      const payload = {
        customer_id: customerId,
        token: activeToken,
        amount: Math.round(amount * 100),
        currency,
        receipt: receipt || `autopay_${Date.now()}`,
        notes,
      };

      const payment = await this.razorpay.payments.createRecurring(payload);

      return {
        success: true,
        data: payment,
      };
    } catch (error: any) {
      console.log("Autopay charge failed:", error);
      return {
        success: false,
        message: error.message || "Failed to process autopay charge",
      };
    }
  }

  /**
   * Fetch payment details from Razorpay
   */
  static async getPaymentDetails(paymentId: string) {
    try {
      const payment = await this.razorpay.payments.fetch(paymentId);
      return {
        success: true,
        data: payment,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || "Failed to fetch payment details",
      };
    }
  }

  /**
   * Create transfer to seller (split payment)
   */
  static async transferToSeller(
    paymentId: string,
    sellerAccountId: string,
    amount: number
  ) {
    try {
      const transfer = await this.razorpay.payments.transfer(paymentId, {
        transfers: [
          {
            account: sellerAccountId,
            amount: Math.round(amount * 100),
            currency: "INR",
          },
        ],
      });

      return {
        success: true,
        data: transfer,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || "Failed to transfer to seller",
      };
    }
  }

  /**
   * Initiate payout to agent via RazorpayX
   * Supports both UPI and Bank Account transfers
   * 
   * @param options Payout configuration including amount, contact, and destination details
   * @returns Payout result with contact ID, fund account ID, payout ID, and status
   */
  static async initiateAgentPayout(options: {
    amount: number;
    currency?: string;
    mode?: "upi" | "imps" | "neft";
    purpose?: string;
    referenceId?: string;
    narration?: string;
    contact: {
      name: string;
      email?: string;
      contact?: string;
      type?: string;
    };
    destination:
      | { type: "upi"; address: string }
      | {
          type: "bank_account";
          accountNumber: string;
          accountHolder: string;
          ifsc: string;
        };
  }) {
    const credentials = config.payment?.razorpayX;
    if (!credentials?.accountNumber) {
      throw new Error("RazorpayX account number missing in config");
    }

    // Validate destination details
    if (options.destination.type === "upi" && !options.destination.address) {
      throw new Error("UPI address is required for UPI payouts");
    }
    if (options.destination.type === "bank_account") {
      const { accountNumber, ifsc, accountHolder } = options.destination;
      if (!accountNumber || !ifsc || !accountHolder) {
        throw new Error("Account number, IFSC, and account holder name are required for bank transfers");
      }
    }

    // Step 1: Create contact in RazorpayX
    const contactPayload = {
      name: options.contact.name,
      email: options.contact.email,
      contact: options.contact.contact,
      type: options.contact.type || credentials.contactType || "employee",
    };

    const contact = await this.razorpayXRequest<any>(
      "/v1/contacts",
      contactPayload
    );

    // Step 2: Create fund account based on destination type
    let accountType: string;
    let accountDetails: Record<string, string>;
    
    if (options.destination.type === "upi") {
      // UPI (VPA - Virtual Payment Address)
      accountType = "vpa";
      accountDetails = {
        address: options.destination.address,
      };
    } else if (options.destination.type === "bank_account") {
      // Bank Account Transfer
      accountType = "bank_account";
      accountDetails = {
        account_number: options.destination.accountNumber,
        ifsc: options.destination.ifsc,
        name: options.destination.accountHolder,
      };
    } else {
      throw new Error(`Unsupported destination type: ${(options.destination as any).type}`);
    }

    const fundAccount = await this.razorpayXRequest<any>("/v1/fund_accounts", {
      contact_id: contact.id,
      account_type: accountType,
      [accountType]: accountDetails,
    });

    // Step 3: Determine payout mode based on destination type
    // UPI: Instant transfer via UPI
    // IMPS: Immediate Payment Service (instant bank transfer)
    // NEFT: National Electronic Funds Transfer (batch processing)
    let payoutMode: "upi" | "imps" | "neft";
    if (options.mode) {
      payoutMode = options.mode;
    } else {
      // Auto-select mode: UPI for UPI addresses, IMPS for bank accounts
      payoutMode = options.destination.type === "upi" ? "upi" : "imps";
    }

    // Step 4: Initiate the payout
    const payout = await this.razorpayXRequest<any>("/v1/payouts", {
      account_number: credentials.accountNumber,
      fund_account_id: fundAccount.id,
      amount: Math.round(options.amount * 100), // Convert to paise
      currency: options.currency || "INR",
      mode: payoutMode,
      purpose: options.purpose || "payout",
      reference_id: options.referenceId || `payout_${Date.now()}`,
      narration: options.narration || "Agent Commission Payout",
      queue_if_low_balance: true, // Queue if balance is low instead of failing
    });

    return {
      contactId: contact.id,
      fundAccountId: fundAccount.id,
      payoutId: payout.id,
      status: payout.status,
      data: payout,
    };
  }
}
