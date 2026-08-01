import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationStatus } from "../modals/insurancequery.model";
import {
  isLoanApplicationCompleted,
  isLoanApplicationTerminal,
} from "../services/callRecordFollowUp.service";

test("approval keeps the call follow-up trail active", () => {
  assert.equal(isLoanApplicationCompleted(ApplicationStatus.APPROVED), false);
  assert.equal(isLoanApplicationTerminal(ApplicationStatus.APPROVED), false);
});

test("successful completion and disbursal close the follow-up trail", () => {
  for (const status of [
    ApplicationStatus.COMPLETED,
    ApplicationStatus.COMPLETED_SUCCESS,
    ApplicationStatus.DISBURSED,
    ApplicationStatus.DISBURSED_PARTIAL_FULL,
  ]) {
    assert.equal(isLoanApplicationCompleted(status), true);
    assert.equal(isLoanApplicationTerminal(status), true);
  }
});

test("rejected and cancelled applications close without being marked successful", () => {
  for (const status of [
    ApplicationStatus.REJECTED,
    ApplicationStatus.REJECTED_BY_BANK,
    ApplicationStatus.CANCELLED,
    ApplicationStatus.CANCELLED_BY_CUSTOMER,
  ]) {
    assert.equal(isLoanApplicationCompleted(status), false);
    assert.equal(isLoanApplicationTerminal(status), true);
  }
});

test("an in-progress application keeps follow-up active", () => {
  assert.equal(isLoanApplicationCompleted(ApplicationStatus.IN_PROGRESS), false);
  assert.equal(isLoanApplicationTerminal(ApplicationStatus.IN_PROGRESS), false);
});
