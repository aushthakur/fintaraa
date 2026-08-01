import { InsuranceQuery } from "../modals/insurancequery.model";
import { UserType } from "../modals/notification.model";
import {
  formatApplicationStatus,
  queueCustomerApplicationCommunications,
} from "./customerApplicationNotification.service";
import { sendSingleNotification } from "./notification.service";

type InsuranceNotificationOptions = {
  previousStatus?: string;
  remarks?: string;
  created?: boolean;
  eventKey?: string;
};

const getApplicationId = (query: any) =>
  String(query?.insuranceId || query?._id?.toString?.() || "").trim();

const getProductName = (query: any) =>
  `${String(query?.typeOfInsurance || "insurance").replace(/[_-]+/g, " ")} insurance`;

const getContact = (query: any) => ({
  name:
    `${query?.firstName || ""} ${query?.lastName || ""}`.trim() ||
    query?.customerId?.name ||
    "Customer",
  email: query?.email || query?.customerId?.email || "",
  mobile: query?.mobile || query?.customerId?.mobile || "",
});

export const notifyInsuranceApplicationStatus = async (
  queryOrId: any,
  options: InsuranceNotificationOptions = {},
) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await InsuranceQuery.findById(queryOrId)
          .select(
            "customerId insuranceId typeOfInsurance status firstName lastName email mobile whatsappConsent communicationConsent updatedAt",
          )
          .populate("customerId", "name email mobile")
          .lean()
      : queryOrId;
  const customerId = query?.customerId?._id || query?.customerId;
  const applicationId = getApplicationId(query);
  if (!customerId || !applicationId) return;

  const contact = getContact(query);
  const productName = getProductName(query);
  await sendSingleNotification({
    type: options.created
      ? "insurance-application-created"
      : "insurance-application-status-updated",
    toUserId: String(customerId),
    toRole: UserType.USER,
    context: {
      applicationId,
      productName,
      status: formatApplicationStatus(query.status),
      previousStatus: formatApplicationStatus(options.previousStatus),
      url: `/application-status?applicationId=${encodeURIComponent(applicationId)}`,
    },
  }).catch((error) =>
    console.log(
      "Failed to send insurance application notification:",
      error?.message || error,
    ),
  );

  await queueCustomerApplicationCommunications({
    kind: "insurance",
    applicationId,
    customerId: String(customerId),
    customerName: contact.name,
    email: contact.email,
    mobile: contact.mobile,
    whatsappConsent:
      query?.whatsappConsent === true ||
      query?.communicationConsent?.whatsapp === true,
    productName,
    status: query.status,
    previousStatus: options.previousStatus,
    remarks: options.remarks,
    eventKey:
      options.eventKey ||
      `${query.status}:${query?.updatedAt?.getTime?.() || query?.updatedAt || "latest"}`,
  });
};
