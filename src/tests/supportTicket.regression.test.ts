import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import Ticket from "../modals/ticket.model";

test("support tickets retain the concrete Admin assignee model", () => {
  const ticket = new Ticket({
    title: "Callback assistance",
    description: "Please call the customer at the scheduled time.",
    requester: new Types.ObjectId(),
    requesterRole: "User",
    assignee: new Types.ObjectId(),
    assigneeModel: "Admin",
    tags: ["callback_request"],
  });

  assert.equal(ticket.validateSync(), undefined);
  assert.equal(ticket.assigneeModel, "Admin");
});

test("staff status interactions do not require an artificial receiver", () => {
  const ticket = new Ticket({
    title: "Application support",
    description: "Track the status change in the same support trail.",
    requester: new Types.ObjectId(),
    requesterRole: "User",
    tags: ["app_support"],
    interactions: [
      {
        initiator: new Types.ObjectId(),
        initiatorType: "Admin",
        action: "status_changed",
      },
    ],
  });

  assert.equal(ticket.validateSync(), undefined);
  assert.equal(ticket.interactions[0].receiver, undefined);
});
