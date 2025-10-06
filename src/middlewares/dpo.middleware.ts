import { v4 as uuidv4 } from "uuid";
import { logger } from "../config/logger";
import { config } from "../config/config";
import axios, { AxiosResponse } from "axios";
import { Request, Response, NextFunction } from "express";

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
 * Compose DPO payload wrapper used by DPO API v6 style endpoints.
 * Adjust keys according to DPO API expected shape.
 */
function makeDpoPayload(body: any) {
  return {
    CompanyToken: config.dpo.companyToken,
    Request: body,
  };
}

/**
 * Parse and normalize DPO verify result.
 * Returns { success: boolean, resultCode?, data? }
 */
function parseDpoResponse(data: any) {
  // DPO responses vary; adjust parsing based on real responses from sandbox/live
  // Many DPO responses include Result.ResultCode or ResultCode fields.
  const resultCode =
    data?.Result?.ResultCode ?? data?.ResultCode ?? data?.resultCode ?? null;
  const success =
    resultCode === "000" || resultCode === 0 || resultCode === "00";
  return { success, resultCode, data };
}

/**
 * Initiate DPO Payment: creates transaction token and returns payment URL.
 * Expects body: { amount, currency?, orderId?, customerName?, customerEmail?, returnUrl? }
 */
export const initiateDPOPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      amount,
      orderId,
      customerName,
      customerEmail,
      serviceType = "Payment",
      currency = config.dpo.defaultCurrency || "USD",
    } = req.body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid amount" });
    }

    // Generate CompanyRef (idempotency key) if not provided
    const companyRef = orderId || `ORD-${Date.now()}-${uuidv4().split("-")[0]}`;

    // Build request body according to DPO API docs
    const requestBody = {
      RequestType: "createToken",
      CompanyToken: config.dpo.companyToken,
      Transaction: {
        CompanyRef: companyRef,
        ServiceType: serviceType,
        PaymentCurrency: currency,
        CustomerEmail: customerEmail || "",
        BackURL: `${config.baseUrl}/checkout`,
        PaymentAmount: Number(amount).toFixed(2),
        RedirectURL: `${config.baseUrl}/payments/dpo/return`,
        CustomerFirstName: customerName ? customerName.split(" ")[0] : "",
        CustomerLastName: customerName
          ? customerName.split(" ").slice(1).join(" ")
          : "",
      },
    };

    logger.info?.("[DPO] initiate - payload created");
    const response = await retry<AxiosResponse<any>>(
      () =>
        axios.post(config.dpo.apiUrl, requestBody, {
          headers: { "Content-Type": "application/json" },
          timeout: config.dpo.timeoutMs || 10000,
        }),
      3,
      300
    );

    const data = response.data;
    const token =
      data?.TransactionToken ??
      data?.TransToken ??
      data?.transactionToken ??
      null;

    if (!token) {
      logger.error?.("[DPO] initiate - missing token", { data });
      return res.status(502).json({
        success: false,
        message: "Failed to create DPO transaction token",
        dpo: data,
      });
    }

    const paymentUrl = `${config.dpo.paymentBaseUrl}?ID=${token}`;
    // Return minimal useful info to client
    return res.status(200).json({
      paymentUrl,
      raw: data,
      companyRef,
      success: true,
      transactionToken: token,
    });
  } catch (err) {
    logger.error?.("[DPO] initiate error", err);
    return next(err);
  }
};

/**
 * Verify DPO Payment by TransactionToken (manual verify).
 * Expects body: { transactionToken }
 * Returns verification details.
 */
export const verifyDPOPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { transactionToken } = req.body;
    if (!transactionToken) {
      return res
        .status(400)
        .json({ success: false, message: "transactionToken is required" });
    }

    const requestBody = {
      RequestType: "verifyToken",
      TransactionToken: transactionToken,
    };

    const response = await retry<AxiosResponse<any>>(
      () =>
        axios.post(config.dpo.apiUrl, makeDpoPayload(requestBody), {
          headers: { "Content-Type": "application/json" },
          timeout: config.dpo.timeoutMs || 10000,
        }),
      3,
      300
    );

    const parsed = parseDpoResponse(response.data);

    if (parsed.success) {
      // TODO: call your internal update: PaymentService.markPaid(parsed.data)
      logger.info?.("[DPO] verify success", { token: transactionToken });
      return res.status(200).json({
        success: true,
        dpo: parsed.data,
        message: "Payment verified successfully",
      });
    } else {
      logger.warn?.("[DPO] verify failed", {
        data: parsed.data,
        token: transactionToken,
      });
      return res.status(400).json({
        success: false,
        dpo: parsed.data,
        message: "Payment verification failed",
      });
    }
  } catch (err) {
    logger.error?.("[DPO] verify error", err);
    return next(err);
  }
};

/**
 * IPN Handler: DPO server-to-server notifications.
 * Expects POST body containing TransactionToken or payload as DPO sends.
 * This endpoint must be reachable publicly and configured in DPO dashboard.
 */
export const dpoIPNHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // DPO sends different shapes; try to find token
    const token =
      req.body?.TransactionToken ??
      req.body?.TransToken ??
      req.query?.TransactionToken ??
      null;

    if (!token) {
      logger.warn?.("[DPO] IPN missing token", {
        body: req.body,
        query: req.query,
      });
      return res.status(400).send("Missing TransactionToken");
    }

    // Verify token to ensure it's genuine
    const requestBody = { RequestType: "verifyToken", TransactionToken: token };

    const response = await retry<AxiosResponse<any>>(
      () =>
        axios.post(config.dpo.apiUrl, makeDpoPayload(requestBody), {
          headers: { "Content-Type": "application/json" },
          timeout: config.dpo.timeoutMs || 10000,
        }),
      3,
      300
    );

    const parsed = parseDpoResponse(response.data);

    if (parsed.success) {
      // Idempotent DB update: mark order as paid if not already
      const companyRef =
        parsed.data?.Transaction?.CompanyRef ?? parsed.data?.CompanyRef ?? null;
      logger.info?.("[DPO] IPN verified - marking success", {
        token,
        companyRef,
      });

      // TODO: Replace with your DB persist logic
      // await PaymentService.handleSuccessfulPayment({ token, companyRef, raw: parsed.data });

      // respond quickly to DPO
      return res.status(200).send("OK");
    } else {
      logger.warn?.("[DPO] IPN verification failed", {
        token,
        data: parsed.data,
      });
      return res.status(400).send("Verification failed");
    }
  } catch (err) {
    logger.error?.("[DPO] IPN error", err);
    return next(err);
  }
};

/**
 * Return Handler: DPO redirects user here after payment.
 * We verify token, update DB, then redirect user to mobile deep link or frontend url.
 *
 * Typical redirect: GET /payments/dpo/return?TransactionToken=XXX&CompanyRef=YYY
 */
export const dpoReturnHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const transactionToken =
      (req.query?.TransactionToken as string) ??
      (req.query?.TransToken as string) ??
      (req.body?.TransactionToken as string);

    const companyRef =
      (req.query?.CompanyRef as string) ??
      (req.query?.companyRef as string) ??
      null;

    if (!transactionToken) {
      logger.warn?.("[DPO] return missing token", {
        query: req.query,
        body: req.body,
      });
      //   const redirectFail = `${config.app.deepLinkScheme}://payment-failed${
      //     companyRef ? `?orderId=${encodeURIComponent(companyRef)}` : ""
      //   }`;
      //   // Fallback: redirect to frontend failure URL
      //   return res.redirect(redirectFail);
    }

    // Verify token with DPO
    const requestBody = {
      RequestType: "verifyToken",
      TransactionToken: transactionToken,
    };

    const response = await retry<AxiosResponse<any>>(
      () =>
        axios.post(config.dpo.apiUrl, makeDpoPayload(requestBody), {
          headers: { "Content-Type": "application/json" },
          timeout: config.dpo.timeoutMs || 10000,
        }),
      3,
      300
    );

    const parsed = parseDpoResponse(response.data);

    if (parsed.success) {
      logger.info?.("[DPO] return verified - success", {
        token: transactionToken,
        companyRef,
      });

      // TODO: persist payment success in your DB, idempotently
      // Example: await PaymentService.markPaid({ companyRef, transactionToken, details: parsed.data });

      // Deep link back into mobile app if configured
      //   const deepSuccess = `${
      //     config.app.deepLinkScheme
      //   }://payment-success?orderId=${encodeURIComponent(companyRef ?? "")}`;
      //   const webSuccess = `${
      //     config.app.webAfterPaymentSuccess || config.app.baseUrl
      //   }/payment-success?orderId=${encodeURIComponent(companyRef ?? "")}`;

      // Prefer deep link for mobile, fall back to web success
      //   const redirectUrl = config.app.deepLinkEnabled ? deepSuccess : webSuccess;

      //   return res.redirect(redirectUrl);
    } else {
      logger.warn?.("[DPO] return verification failed", {
        token: transactionToken,
        data: parsed.data,
      });

      // TODO: Optionally mark failed in DB

      //   const deepFail = `${
      //     config.app.deepLinkScheme
      //   }://payment-failed?orderId=${encodeURIComponent(companyRef ?? "")}`;
      //   const webFail = `${
      //     config.app.webAfterPaymentFail || config.app.baseUrl
      //   }/payment-failed?orderId=${encodeURIComponent(companyRef ?? "")}`;

      //   const redirectUrl = config.app.deepLinkEnabled ? deepFail : webFail;
      //   return res.redirect(redirectUrl);
    }
  } catch (err) {
    logger.error?.("[DPO] return handler error", err);
    return next(err);
  }
};
