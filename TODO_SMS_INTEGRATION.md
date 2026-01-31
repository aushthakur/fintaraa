# SMS Integration Plan

## Tasks

### 1. Fix metaData → metaMap in smsService.ts ✅

- Update field name to match Airtel IQ API spec

### 2. Integrate SMS in user.controller.ts ✅

- Import sendSMS
- Replace console.log with actual SMS sending in generateOtp

### 3. Integrate SMS in agent.controller.ts ✅

- Import sendSMS
- Replace console.log with actual SMS sending in sendOtp

### 4. Integrate SMS in agency.controller.ts ✅

- Import sendSMS
- Replace console.log with actual SMS sending in sendOtp

## Status: Completed ✅

## Environment Variables Required:

```
SMS_ENABLED=true
SMS_PROVIDER=airtel_iq
AIRTEL_IQ_SMS_CUSTOMER_ID=your_customer_id
AIRTEL_IQ_SMS_SENDER_ID=your_sender_id
AIRTEL_IQ_SMS_ENTITY_ID=your_entity_id
AIRTEL_IQ_SMS_TEMPLATE_ID=your_template_id
AIRTEL_IQ_SMS_MESSAGE_TYPE=PROMOTIONAL
```
