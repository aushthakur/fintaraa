import { v4 as uuidv4 } from "uuid";
import { config } from "../config/config";
import axios, { AxiosResponse } from "axios";
import { Request, Response, NextFunction } from "express";
import { Booking, BookingStatus } from "../modals/booking.model";
import mongoose from "mongoose";

// Helper: basic retry for HTTP calls
async function retry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 500
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2;
      }
    }
  }
  throw lastErr;
}

/**
 * Get PesaPal OAuth access token
 * Returns bearer token for API authentication (valid for 5 minutes)
 */
async function getPesaPalToken(): Promise<string> {
  try {
    const tokenUrl = `${config.pesapal.apiUrl}/api/Auth/RequestToken`;

    console.log("[PesaPal] Requesting token from:", tokenUrl);

    const response = await axios.post(
      tokenUrl,
      {
        consumer_key: config.pesapal.consumerKey,
        consumer_secret: config.pesapal.consumerSecret,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 10000,
      }
    );

    const token = response.data?.token;
    if (!token) {
      console.log("[PesaPal] Token response:", response.data);
      throw new Error("Failed to get access token from PesaPal");
    }

    console.log("[PesaPal] Token received successfully");
    return token;
  } catch (err: any) {
    console.log("[PesaPal] Token request failed", {
      url: `${config.pesapal.apiUrl}/api/Auth/RequestToken`,
      error: err.response?.data || err.message,
      status: err.response?.status,
      headers: err.response?.headers,
    });
    throw err;
  }
}

/**
 * Register IPN URL with PesaPal and get IPN ID
 * This should be called once during setup to register your webhook URL
 * Returns the IPN ID which is required for order submissions
 */
export const registerPesaPalIPN = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = await getPesaPalToken();
    const ipnUrl = `${config.baseUrl}/api/booking/ipn`; // Fixed URL path

    const ipnRegisterUrl = `${config.pesapal.apiUrl}/api/URLSetup/RegisterIPN`;

    console.log("[PesaPal] Registering IPN URL:", { ipnUrl, apiUrl: ipnRegisterUrl });

    const response = await axios.post(
      ipnRegisterUrl,
      {
        url: ipnUrl,
        ipn_notification_type: "GET", // GET or POST
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      }
    );

    const ipnId = response.data?.ipn_id;
    if (!ipnId) {
      console.log("[PesaPal] IPN registration response:", response.data);
      throw new Error("Failed to register IPN URL with PesaPal - no ipn_id returned");
    }

    console.log("[PesaPal] IPN URL registered successfully", {
      ipnUrl,
      ipnId,
      response: response.data
    });

    return res.status(200).json({
      success: true,
      message: "IPN URL registered successfully",
      ipnUrl,
      ipnId,
      response: response.data,
      note: "Save this ipn_id as PESAPAL_DEFAULT_NOTIFICATION_ID in your environment variables"
    });
  } catch (err: any) {
    console.log("[PesaPal] IPN registration failed", {
      error: err.response?.data || err.message,
      status: err.response?.status,
      url: err.config?.url,
    });
    return next(err);
  }
};

/**
 * Test PesaPal credentials and connection
 * Use this endpoint to verify your setup before going live
 */
export const testPesaPalConnection = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const testUrl = `${config.pesapal.apiUrl}/api/Auth/RequestToken`;

    console.log("[PesaPal] Testing connection...", {
      apiUrl: config.pesapal.apiUrl,
      consumerKey: config.pesapal.consumerKey ? config.pesapal.consumerKey.substring(0, 8) + "..." : "NOT SET",
      consumerSecret: config.pesapal.consumerSecret ? "SET" : "NOT SET",
      testUrl,
    });

    // Test 1: Check if credentials are set
    if (!config.pesapal.consumerKey || !config.pesapal.consumerSecret) {
      return res.status(400).json({
        success: false,
        message: "PesaPal credentials not configured",
        missing: {
          consumerKey: !config.pesapal.consumerKey,
          consumerSecret: !config.pesapal.consumerSecret,
        }
      });
    }

    // Test 2: Try to get token
    const token = await getPesaPalToken();

    if (token) {
      // Test 3: Try to get IPN list to verify token works
      const ipnResponse = await axios.get(
        `${config.pesapal.apiUrl}/api/URLSetup/GetIpnList`,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 10000,
        }
      );

      return res.status(200).json({
        success: true,
        message: "PesaPal connection successful!",
        details: {
          apiUrl: config.pesapal.apiUrl,
          tokenReceived: true,
          ipnListFetched: true,
          registeredIPNs: ipnResponse.data,
        }
      });
    }
  } catch (err: any) {
    console.log("[PesaPal] Connection test failed", {
      error: err.response?.data || err.message,
      status: err.response?.status,
      url: err.config?.url,
    });

    return res.status(500).json({
      success: false,
      message: "PesaPal connection failed",
      error: {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
        url: err.config?.url,
      },
      troubleshooting: {
        checkCredentials: "Verify PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET in your environment",
        checkUrl: "Ensure you're using the correct API URL for your environment",
        checkNetwork: "Verify your server can reach PesaPal APIs",
      }
    });
  }
};

/**
 * Initiate PesaPal Payment: submits order request and returns payment URL.
 * Expects body: { 
 *   amount, 
 *   currency?, 
 *   orderId?, 
 *   customerName?, 
 *   customerEmail?, 
 *   customerPhone?, 
 *   description?,
 *   notificationId? // IPN ID from registerPesaPalIPN
 * }
 */
export const initiatePesaPalPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      amount,
      orderId,
      address,
      customerName,
      customerEmail,
      customerPhone,
      currency = "KES",
      billingCountry = "KE",
      description = "Payment",
      notificationId, // IPN ID from registration
    } = req.body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid amount" });
    }

    if (!customerEmail && !customerPhone) {
      return res.status(400).json({
        success: false,
        message: "Customer email or phone is required",
      });
    }

    // if (!notificationId && !config.pesapal.defaultNotificationId) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "notification_id is required. Please register IPN URL first.",
    //   });
    // }

    // Generate unique order ID if not provided
    const merchantReference =
      orderId || `ORD-${Date.now()}-${uuidv4().split("-")[0]}`;

    // Get access token
    const token = await getPesaPalToken();

    // Split customer name
    const nameParts = customerName ? customerName.trim().split(" ") : [""];
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    // Build request body according to PesaPal API 3.0
    const requestBody = {
      currency,
      description,
      id: uuidv4(),
      amount: Number(amount),
      branch: "Default Branch",
      notification_id: notificationId,
      callback_url: `${config.baseUrl}/api/booking/return`,
      billing_address: {
        last_name: lastName,
        first_name: firstName,
        city: address?.city ?? "",
        state: address?.state ?? "",
        country_code: billingCountry,
        line_1: address?.street ?? "",
        line_2: address?.street ?? "",
        phone_number: customerPhone || "",
        email_address: customerEmail || "",
        zip_code: address?.postalCode ?? "",
        postal_code: address?.postalCode ?? "",
      },
      merchant_reference: merchantReference,
    };

    console.log("[PesaPal] initiate - sending order request", {
      merchantReference,
      amount,
      currency,
    });

    const response = await retry<AxiosResponse<any>>(
      () =>
        axios.post(
          `${config.pesapal.apiUrl}/api/Transactions/SubmitOrderRequest`,
          requestBody,
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            timeout: 10000,
          }
        ),
      3,
      300
    );

    const data = response.data;
    const orderTrackingId = data?.order_tracking_id;
    const merchantRef = data?.merchant_reference;
    const redirectUrl = data?.redirect_url;

    if (!orderTrackingId || !redirectUrl) {
      console.log("[PesaPal] initiate - missing required fields", { data });
      return res.status(502).json({
        success: false,
        message: "Failed to create PesaPal payment request",
        pesapal: data,
      });
    }

    await Booking.updateOne(
      { _id: new mongoose.Types.ObjectId(orderId) },
      {
        $set: {
          paymentDetails: {},
          orderTrackingId: orderTrackingId,
          merchantReference: merchantReference,
        },
      },
    );

    console.log("Payment URL: ", redirectUrl);

    // Return payment details to client
    return res.status(200).json({
      success: true,
      paymentUrl: redirectUrl,
      orderTrackingId,
      merchantReference: merchantRef,
      raw: data,
    });
  } catch (err) {
    console.log("[PesaPal] initiate error", err);
    return next(err);
  }
};

/**
 * Verify PesaPal Payment by OrderTrackingId (manual verify).
 * Expects body: { orderTrackingId }
 * Returns verification details.
 */
export const verifyPesaPalPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { orderTrackingId } = req.body;
    if (!orderTrackingId) {
      return res
        .status(400)
        .json({ success: false, message: "orderTrackingId is required" });
    }

    // Get access token
    const token = await getPesaPalToken();

    const response = await retry<AxiosResponse<any>>(
      () =>
        axios.get(
          `${config.pesapal.apiUrl}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            timeout: 10000,
          }
        ),
      3,
      300
    );

    const data = response.data;
    const paymentStatus = data?.payment_status_description?.toLowerCase();
    const paymentStatusCode = data?.status_code;

    // PesaPal status codes: 1 = Completed, 2 = Failed, 3 = Reversed
    const isSuccess = paymentStatus === "completed" || paymentStatusCode === 1;

    if (isSuccess) {
      // TODO: call your internal update: PaymentService.markPaid(data)
      console.log("[PesaPal] verify success", { orderTrackingId });
      return res.status(200).json({
        success: true,
        pesapal: data,
        status: paymentStatus,
        statusCode: paymentStatusCode,
        message: "Payment verified successfully",
      });
    } else {
      console.log("[PesaPal] verify failed", {
        data,
        orderTrackingId,
        status: paymentStatus,
        statusCode: paymentStatusCode,
      });
      return res.status(400).json({
        pesapal: data,
        success: false,
        status: paymentStatus,
        statusCode: paymentStatusCode,
        message: "Payment verification failed",
      });
    }
  } catch (err) {
    console.log("[PesaPal] verify error", err);
    return next(err);
  }
};

/**
 * IPN Handler: PesaPal server-to-server notifications.
 * Expects GET/POST with OrderTrackingId and other parameters.
 * This endpoint must be publicly accessible and registered with PesaPal.
 */
export const pesaPalIPNHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // PesaPal sends different parameters based on configuration
    const orderTrackingId =
      req.query?.OrderTrackingId ||
      req.body?.OrderTrackingId ||
      req.query?.orderTrackingId ||
      req.body?.orderTrackingId;

    const orderNotificationType =
      req.query?.OrderNotificationType ||
      req.body?.OrderNotificationType ||
      "CHANGE";

    const merchantReference =
      req.query?.OrderMerchantReference ||
      req.body?.OrderMerchantReference ||
      req.query?.merchantReference ||
      req.body?.merchantReference;

    if (!orderTrackingId) {
      console.log("[PesaPal] IPN missing orderTrackingId", {
        body: req.body,
        query: req.query,
      });
      return res.status(400).send("Missing OrderTrackingId");
    }

    // Get access token
    const token = await getPesaPalToken();

    // Verify transaction status with PesaPal
    const response = await retry<AxiosResponse<any>>(
      () =>
        axios.get(
          `${config.pesapal.apiUrl}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            timeout: 10000,
          }
        ),
      3,
      300
    );

    const data = response.data;
    const paymentStatus = data?.payment_status_description?.toLowerCase();
    const paymentStatusCode = data?.status_code;
    const isSuccess = paymentStatus === "completed" || paymentStatusCode === 1;

    if (isSuccess) {
      console.log("[PesaPal] IPN verified - marking success", {
        orderTrackingId,
        merchantReference,
        status: paymentStatus,
        statusCode: paymentStatusCode,
      });

      // TODO: Replace with your DB persist logic (make it idempotent)
      // await PaymentService.handleSuccessfulPayment({
      //   orderTrackingId,
      //   merchantReference,
      //   raw: data
      // });

      return res.status(200).send("OK");
    } else {
      console.log("[PesaPal] IPN verification failed or pending", {
        orderTrackingId,
        status: paymentStatus,
        statusCode: paymentStatusCode,
        data,
      });

      // Still return OK to prevent PesaPal from retrying
      return res.status(200).send("OK");
    }
  } catch (err) {
    console.log("[PesaPal] IPN error", err);
    return res.status(500).send("Internal server error");
  }
};

/**
 * Return Handler: PesaPal redirects user here after payment.
 * We verify transaction status, update DB, then redirect user appropriately.
 *
 * Typical redirect: GET /api/booking/return?OrderTrackingId=XXX&OrderMerchantReference=YYY&OrderNotificationType=CHANGE
 */
export const pesaPalReturnHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const orderTrackingId =
      (req.query?.OrderTrackingId as string) ||
      (req.query?.orderTrackingId as string) ||
      (req.body?.OrderTrackingId as string);

    const merchantReference =
      (req.query?.OrderMerchantReference as string) ||
      (req.query?.merchantReference as string) ||
      (req.body?.merchantReference as string);

    const orderNotificationType =
      (req.query?.OrderNotificationType as string) ||
      (req.query?.orderNotificationType as string) ||
      (req.body?.orderNotificationType as string);

    if (!orderTrackingId) {
      console.log("[PesaPal] return missing orderTrackingId", {
        query: req.query,
        body: req.body,
      });

      // Redirect to failure page
      const failUrl = `${config.frontendUrl}/payment-failed${merchantReference ? `?orderId=${encodeURIComponent(merchantReference)}` : ""
        }`;
      return res.redirect(failUrl);
    }

    // Get access token
    const token = await getPesaPalToken();

    // Verify transaction status with PesaPal
    const response = await retry<AxiosResponse<any>>(
      () =>
        axios.get(
          `${config.pesapal.apiUrl}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            timeout: 10000,
          }
        ),
      3,
      300
    );

    const data = response.data;
    const paymentStatus = data?.payment_status_description?.toLowerCase();
    const paymentStatusCode = data?.status_code;
    const isSuccess = paymentStatus === "completed" || paymentStatusCode === 1;

    if (isSuccess) {
      console.log("[PesaPal] return verified - success", {
        orderTrackingId,
        merchantReference,
        status: paymentStatus,
        statusCode: paymentStatusCode,
      });

      await Booking.updateOne(
        { orderTrackingId },
        {
          $set: {
            paymentDetails: data,
            paymentStatus: "paid",
            status: BookingStatus.CONFIRMED,
          },
        }
      );

      // Redirect to success page
      const successUrl = `${config.frontendUrl}/payment-success${merchantReference ? `?orderId=${encodeURIComponent(merchantReference)}` : ""
        }`;

      return res.redirect(successUrl);
    } else {
      console.log("[PesaPal] return verification failed or pending", {
        orderTrackingId,
        status: paymentStatus,
        statusCode: paymentStatusCode,
        data,
      });

      // For pending payments, redirect to pending page
      if (paymentStatus === "pending" || paymentStatusCode === 0) {
        const pendingUrl = `${config.frontendUrl}/payment-pending${merchantReference ? `?orderId=${encodeURIComponent(merchantReference)}` : ""
          }`;
        return res.redirect(pendingUrl);
      }

      const failUrl = `${config.frontendUrl}/payment-failed${merchantReference ? `?orderId=${encodeURIComponent(merchantReference)}` : ""
        }`;
      return res.redirect(failUrl);
    }
  } catch (err) {
    console.log("[PesaPal] return handler error", err);

    // Redirect to failure page on error
    const failUrl = `${config.frontendUrl}/payment-failed`;
    return res.redirect(failUrl);
  }
};

/**
 * Get transaction details by merchant reference or tracking ID
 * Useful for admin/dashboard functionality
 */
export const getPesaPalTransaction = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { orderTrackingId, merchantReference } = req.query;

    if (!orderTrackingId && !merchantReference) {
      return res.status(400).json({
        success: false,
        message: "orderTrackingId or merchantReference is required",
      });
    }

    const token = await getPesaPalToken();
    let url = `${config.pesapal.apiUrl}/api/Transactions/GetTransactionStatus`;

    if (orderTrackingId) {
      url += `?orderTrackingId=${orderTrackingId}`;
    } else if (merchantReference) {
      url += `?merchantReference=${merchantReference}`;
    }

    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    });

    return res.status(200).json({
      success: true,
      transaction: response.data,
    });
  } catch (err) {
    console.log("[PesaPal] get transaction error", err);
    return next(err);
  }
};

/**
 * Request refund for a completed transaction
 * Expects body: { orderTrackingId, amount?, reason? }
 */
export const requestPesaPalRefund = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { orderTrackingId, amount, reason = "Customer request" } = req.body;

    if (!orderTrackingId) {
      return res.status(400).json({
        success: false,
        message: "orderTrackingId is required",
      });
    }

    const token = await getPesaPalToken();

    const requestBody = {
      reason,
      username: "merchant",
      confirmation_code: orderTrackingId,
      amount: amount ? Number(amount) : undefined, // Partial refund if specified
    };

    const response = await axios.post(
      `${config.pesapal.apiUrl}/api/Transactions/RefundRequest`,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      }
    );

    console.log("[PesaPal] refund requested", {
      orderTrackingId,
      amount,
      response: response.data,
    });

    return res.status(200).json({
      success: true,
      message: "Refund request submitted successfully",
      pesapal: response.data,
    });
  } catch (err) {
    console.log("[PesaPal] refund request error", err);
    return next(err);
  }
};