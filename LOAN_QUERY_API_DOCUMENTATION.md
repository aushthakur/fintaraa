# Loan Query API Documentation

## Table of Contents
1. [API Overview](#api-overview)
2. [Endpoints](#endpoints)
3. [Authentication](#authentication)
4. [Request Format](#request-format)
5. [Common Fields (Required for All Loans)](#common-fields-required-for-all-loans)
6. [Loan Type Specific Fields](#loan-type-specific-fields)
7. [File Uploads](#file-uploads)
8. [Document Types](#document-types)
9. [Validation Rules](#validation-rules)
10. [Response Format](#response-format)
11. [Examples](#examples)

---

## API Overview

The Loan Query API allows users to create, read, update, and delete loan applications for various loan types. Each loan type has specific fields that must be provided in the `policyDetails` object.

**Base URL:** `/api/loanquery`

**Content-Type:** `multipart/form-data` (for file uploads)

---

## Endpoints

### 1. Create Loan Query
- **Method:** `POST`
- **URL:** `/api/loanquery/`
- **Description:** Creates a new loan query application
- **Authentication:** Required

### 2. Get All Loan Queries
- **Method:** `GET`
- **URL:** `/api/loanquery/`
- **Description:** Retrieves all loan queries (filtered by user role)
- **Authentication:** Required

### 3. Get Loan Query by ID
- **Method:** `GET`
- **URL:** `/api/loanquery/:id`
- **Description:** Retrieves a specific loan query (only draft queries can be fetched)
- **Authentication:** Required

### 4. Update Loan Query
- **Method:** `PUT`
- **URL:** `/api/loanquery/:id`
- **Description:** Updates an existing loan query (only draft queries can be updated)
- **Authentication:** Required

### 5. Delete Loan Query
- **Method:** `DELETE`
- **URL:** `/api/loanquery/:id`
- **Description:** Deletes a loan query
- **Authentication:** Required

---

## Authentication

All endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

The `customerId` is automatically extracted from the authenticated user token, so you don't need to include it in the request body.

---

## Request Format

### Content-Type
Use `multipart/form-data` for all requests (required for file uploads).

### Request Structure
The request body should contain:
1. **Common Fields** - Required for all loan types (see below)
2. **Loan Type** - The specific loan type (`loanType`)
3. **Policy Details** - Loan-specific fields (nested as `policyDetails[key]`)
4. **File Uploads** - Document files

---

## Common Fields (Required for All Loans)

These fields are **mandatory** for all loan types:

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `loanAmount` | Number | Yes | Loan amount requested | Must be a positive number |
| `firstName` | String | Yes | Applicant's first name | Trimmed, required |
| `lastName` | String | Yes | Applicant's last name | Trimmed, required |
| `dateOfBirth` | Date | Yes | Date of birth | Format: `YYYY-MM-DD` |
| `gender` | String | Yes | Gender | Enum: `male`, `female`, `other`, `prefer_not_to_say` |
| `marriedStatus` | String | Yes | Marital status | Any string value |
| `mobile` | String | Yes | Mobile number | 10 digits, trimmed |
| `email` | String | Yes | Email address | Valid email, lowercase, trimmed |
| `panNumber` | String | Yes | PAN card number | 10 characters, uppercase |
| `aadhaarNumber` | String | Yes | Aadhaar number | 12 digits, trimmed |
| `pincode` | String | Yes | PIN code | 6 digits, trimmed |
| `state` | String | Yes | State | Any string, trimmed |
| `city` | String | Yes | City | Any string, trimmed |
| `street` | String | Yes | Street address | Any string, trimmed |
| `employmentType` | String | Yes | Employment type | Enum: `salaried`, `self_employed`, `self_employed_professional`, `self_employed_non_professional` |
| `industry` | String | Yes | Industry | Any string, trimmed |
| `companyName` | String | Yes | Company name | Any string, trimmed |
| `monthlyIncome` | Number | Yes | Monthly income | Must be a number (can be 0 for students) |
| `workExperience` | Number | Yes | Work experience in years | Must be a number (can be 0 for students) |
| `officeAddress` | String | Yes | Office address | Any string, trimmed |
| `bankName` | String | Yes | Bank name | Any string, trimmed |
| `accountType` | String | Yes | Account type | Enum: `savings`, `current`, `salary` |
| `accountNumber` | String | Yes | Account number | Any string, trimmed |
| `ifscCode` | String | Yes | IFSC code | 11 characters, uppercase |
| `loanType` | String | Yes | Loan type | See [Loan Types](#loan-types) |
| `status` | String | No | Application status | Default: `pending`. Enum: See [Status Values](#status-values) |
| `bankStatementUrl` | File | Optional | Bank statement file | PDF/Image file |

---

## Loan Types

Available loan types (use exact values):

1. `personal_loan`
2. `education_loan`
3. `vehicle_loan`
4. `gold_loan`
5. `loan_against_car`
6. `instant_loan`
7. `loan_against_property`
8. `renovation_loan`
9. `working_capital_loan`
10. `loan_against_security`
11. `machinery_loan`
12. `home_loan`
13. `business_loan`

---

## Status Values

Available status values:

- `draft` - Draft application (can be updated, validation skipped)
- `pending` - Pending review (default)
- `submitted` - Submitted for review
- `under_review` - Under review
- `approved` - Approved
- `rejected` - Rejected
- `active` - Active loan
- `completed` - Completed
- `cancelled` - Cancelled
- `expired` - Expired
- `in_progress` - In progress
- `document_verification` - Document verification
- `disbursed` - Disbursed

---

## Loan Type Specific Fields

Each loan type has specific fields that must be provided in `policyDetails`. Use the format: `policyDetails[fieldName]`

### 1. PERSONAL_LOAN (`personal_loan`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `purpose` | String | Yes | Purpose of the loan |
| `existingEmisOrLoans` | String | Yes | Details of existing EMIs or loans |
| `tenure` | String/Number | Yes | Loan tenure in months |
| `salarySlipUrl` | File | Optional | Salary slip document |

**Example:**
```
policyDetails[purpose]: Home renovation
policyDetails[existingEmisOrLoans]: Yes, one car loan EMI of ₹18,000 per month
policyDetails[tenure]: 60
salarySlipUrl: [FILE]
```

---

### 2. EDUCATION_LOAN (`education_loan`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `studentName` | String | Yes | Name of the student |
| `courseName` | String | Yes | Name of the course |
| `instituteName` | String | Yes | Name of the institute/university |
| `countryOfStudy` | String | Yes | Country where studying |
| `courseDuration` | String/Number | Yes | Course duration in months |
| `totalCourseFee` | String/Number | Yes | Total course fee |
| `coApplicantParentName` | String | Yes | Name of parent/guardian (co-applicant) |
| `admissionLetterUrl` | File | Optional | Admission letter document |
| `feeStructureUrl` | File | Optional | Fee structure document |
| `tenure` | String/Number | Yes | Loan tenure in months |

**Example:**
```
policyDetails[studentName]: Arjun Sharma
policyDetails[courseName]: Master of Science in Computer Science
policyDetails[instituteName]: Massachusetts Institute of Technology
policyDetails[countryOfStudy]: United States
policyDetails[courseDuration]: 24
policyDetails[totalCourseFee]: 85000
policyDetails[coApplicantParentName]: Rajesh Sharma
policyDetails[tenure]: 120
admissionLetterUrl: [FILE]
feeStructureUrl: [FILE]
```

---

### 3. VEHICLE_LOAN (`vehicle_loan`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `vehicleType` | String | Yes | Type of vehicle (Car, Bike, SUV, etc.) |
| `carMakeModel` | String | Yes | Make and model of the vehicle |
| `yearOfManufacture` | String/Number | Yes | Year of manufacture |
| `vehicleValue` | String/Number | Yes | Total on-road price of the vehicle |
| `dealerName` | String | Yes | Name of the dealer |
| `downPaymentAmount` | String/Number | Yes | Down payment amount |
| `tenure` | String/Number | Yes | Loan tenure in months |
| `rcCopyUrl` | File | Optional | RC copy document |

**Example:**
```
policyDetails[vehicleType]: Car
policyDetails[carMakeModel]: Honda City VX CVT
policyDetails[yearOfManufacture]: 2024
policyDetails[vehicleValue]: 1200000
policyDetails[dealerName]: Honda Cars India Ltd, Andheri
policyDetails[downPaymentAmount]: 400000
policyDetails[tenure]: 60
rcCopyUrl: [FILE]
```

---

### 4. GOLD_LOAN (`gold_loan`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `goldType` | String | Yes | Type of gold (Jewellery, Coins, Bars, etc.) |
| `weightInGrams` | String/Number | Yes | Weight of gold in grams |
| `purity` | String/Number | Yes | Purity in karat (18, 22, 24) |
| `estimatedValue` | String/Number | Yes | Estimated market value |
| `tenure` | String/Number | Yes | Loan tenure in months |
| `goldPhotosUrl` | File | Optional | Photos of gold/jewellery (can upload multiple, max 10) |

**Example:**
```
policyDetails[goldType]: Jewellery
policyDetails[weightInGrams]: 250
policyDetails[purity]: 22
policyDetails[estimatedValue]: 350000
policyDetails[tenure]: 12
goldPhotosUrl: [FILE] (can upload multiple)
```

---

### 5. LOAN_AGAINST_CAR (`loan_against_car`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `carRegistrationNumber` | String | Yes | Vehicle registration number |
| `carCompanyAndModel` | String | Yes | Company and model of the car |
| `yearOfManufacture` | String/Number | Yes | Year of manufacture |
| `carIdentificationNumber` | String | Yes | VIN/Chassis number (17 characters) |
| `carInsuranceUrl` | File | Optional | Car insurance document |

**Example:**
```
policyDetails[carRegistrationNumber]: KA-03-MH-1234
policyDetails[carCompanyAndModel]: Hyundai Creta SX
policyDetails[yearOfManufacture]: 2020
policyDetails[carIdentificationNumber]: KMHGC41DLKU123456
carInsuranceUrl: [FILE]
```

---

### 6. INSTANT_LOAN (`instant_loan`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `employmentType` | String | Yes | Employment type |
| `salarySlipUrl` | File | Optional | Salary slip document |
| `lastMonthBankStatementUrl` | File | Optional | Last month's bank statement |
| `cibilCheckConsent` | String/Boolean | Yes | Consent for CIBIL check (true/false or "yes"/"no") |

**Example:**
```
policyDetails[employmentType]: salaried
policyDetails[cibilCheckConsent]: true
salarySlipUrl: [FILE]
lastMonthBankStatementUrl: [FILE]
```

---

### 7. LOAN_AGAINST_PROPERTY (`loan_against_property`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `propertyType` | String | Yes | Type of property |
| `propertyAddress` | String | Yes | Property address |
| `propertyOwnerName` | String | Yes | Name of property owner |
| `estimatedMarketValue` | String/Number | Yes | Estimated market value |
| `propertyDocumentsUrl` | File | Optional | Property documents (can upload multiple, max 10) |
| `propertyAge` | String/Number | Yes | Age of property in years |

**Example:**
```
policyDetails[propertyType]: Residential
policyDetails[propertyAddress]: 123, MG Road, Bangalore
policyDetails[propertyOwnerName]: John Doe
policyDetails[estimatedMarketValue]: 5000000
policyDetails[propertyAge]: 5
propertyDocumentsUrl: [FILE] (can upload multiple)
```

---

### 8. RENOVATION_LOAN (`renovation_loan`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `propertyOwnershipProofUrl` | File | Optional | Property ownership proof |
| `estimatedRenovationCost` | String/Number | Yes | Estimated renovation cost |
| `contractorArchitectName` | String | Yes | Name of contractor/architect |
| `renovationEstimateUrl` | File | Optional | Renovation estimate document |

**Example:**
```
policyDetails[estimatedRenovationCost]: 800000
policyDetails[contractorArchitectName]: ABC Construction Pvt Ltd
propertyOwnershipProofUrl: [FILE]
renovationEstimateUrl: [FILE]
```

---

### 9. WORKING_CAPITAL_LOAN (`working_capital_loan`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `businessRegistrationType` | String | Yes | Type of business registration |
| `businessVintage` | String/Number | Yes | Business vintage in years |
| `annualTurnover` | String/Number | Yes | Annual turnover |
| `gstNumber` | String | Yes | GST number |
| `itrUrl` | File | Optional | ITR document |
| `gstReturnsUrl` | File | Optional | GST returns document |

**Example:**
```
policyDetails[businessRegistrationType]: Private Limited
policyDetails[businessVintage]: 5
policyDetails[annualTurnover]: 5000000
policyDetails[gstNumber]: 27ABCDE1234F1Z5
itrUrl: [FILE]
gstReturnsUrl: [FILE]
```

---

### 10. LOAN_AGAINST_SECURITY (`loan_against_security`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `typeOfSecurity` | String | Yes | Type of security (Shares, FD, etc.) |
| `securityValue` | String/Number | Yes | Value of security |
| `dematAccountNumber` | String | Yes | Demat account number |
| `nameOfDepository` | String | Yes | Name of depository (NSDL, CDSL) |
| `dematStatementOrFdCopyUrl` | File | Optional | Demat statement or FD copy |

**Example:**
```
policyDetails[typeOfSecurity]: Shares
policyDetails[securityValue]: 1000000
policyDetails[dematAccountNumber]: 1234567890123456
policyDetails[nameOfDepository]: NSDL
dematStatementOrFdCopyUrl: [FILE]
```

---

### 11. MACHINERY_LOAN (`machinery_loan`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `typeOfMachinery` | String | Yes | Type of machinery |
| `newOrUsed` | String | Yes | New or used machinery |
| `machineryCost` | String/Number | Yes | Cost of machinery |
| `vendorSupplierName` | String | Yes | Name of vendor/supplier |
| `proformaInvoiceOrQuotationUrl` | File | Optional | Proforma invoice or quotation |
| `expectedDeliveryDate` | String | Yes | Expected delivery date (YYYY-MM-DD) |

**Example:**
```
policyDetails[typeOfMachinery]: CNC Machine
policyDetails[newOrUsed]: New
policyDetails[machineryCost]: 2000000
policyDetails[vendorSupplierName]: ABC Machinery Pvt Ltd
policyDetails[expectedDeliveryDate]: 2024-12-31
proformaInvoiceOrQuotationUrl: [FILE]
```

---

### 12. HOME_LOAN (`home_loan`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `propertyType` | String | Yes | Type of property |
| `propertyLocation` | String | Yes | Property location |
| `propertyValue` | String/Number | Yes | Property value |
| `ownershipType` | String | Yes | Ownership type |
| `builderSellerName` | String | Yes | Builder/Seller name |
| `propertyDocumentsUrl` | File | Optional | Property documents (can upload multiple, max 10) |
| `tenure` | String/Number | Yes | Loan tenure in months |
| `preferredBank` | String | Yes | Preferred bank |
| `coApplicants` | String/Object | Optional | Co-applicant details (can be JSON string or object) |

**Example:**
```
policyDetails[propertyType]: Apartment
policyDetails[propertyLocation]: Sector 15, Noida
policyDetails[propertyValue]: 8000000
policyDetails[ownershipType]: Freehold
policyDetails[builderSellerName]: DLF Limited
policyDetails[tenure]: 240
policyDetails[preferredBank]: HDFC Bank
policyDetails[coApplicants]: [{"name":"Sneha Patel","mobile":"9876543210","pan":"ABCDE1234F","relation":"spouse"}]
propertyDocumentsUrl: [FILE] (can upload multiple)
```

---

### 13. BUSINESS_LOAN (`business_loan`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `businessName` | String | Yes | Business name |
| `businessType` | String | Yes | Type of business |
| `natureOfBusiness` | String | Yes | Nature of business |
| `businessVintage` | String/Number | Yes | Business vintage in years |
| `annualTurnover` | String/Number | Yes | Annual turnover |
| `purposeOfLoan` | String | Yes | Purpose of loan |
| `collateralAvailable` | String | Yes | Collateral available (Yes/No) |
| `gstReturnsUrl` | File | Optional | GST returns document |
| `businessRegistrationCertificateUrl` | File | Optional | Business registration certificate |
| `tenure` | String/Number | Yes | Loan tenure in months |

**Note:** `businessRegistrationCertificateUrl` is not in the routes, so you may need to use a document type or add it to routes.

**Example:**
```
policyDetails[businessName]: Tech Solutions Pvt Ltd
policyDetails[businessType]: Private Limited
policyDetails[natureOfBusiness]: IT Services
policyDetails[businessVintage]: 3
policyDetails[annualTurnover]: 3000000
policyDetails[purposeOfLoan]: Working capital and expansion
policyDetails[collateralAvailable]: Yes
policyDetails[tenure]: 60
gstReturnsUrl: [FILE]
```

---

## File Uploads

### Policy-Specific File Fields

These files go into `policyDetails` and are specific to certain loan types:

| Field Name | Loan Types | Max Files | Description |
|------------|------------|-----------|-------------|
| `salarySlipUrl` | personal_loan, instant_loan | 1 | Salary slip |
| `admissionLetterUrl` | education_loan | 1 | Admission letter |
| `feeStructureUrl` | education_loan | 1 | Fee structure |
| `rcCopyUrl` | vehicle_loan | 1 | RC copy |
| `goldPhotosUrl` | gold_loan | 10 | Gold/jewellery photos |
| `carInsuranceUrl` | loan_against_car | 1 | Car insurance |
| `lastMonthBankStatementUrl` | instant_loan | 1 | Last month bank statement |
| `propertyDocumentsUrl` | loan_against_property, home_loan | 10 | Property documents |
| `propertyOwnershipProofUrl` | renovation_loan | 1 | Property ownership proof |
| `renovationEstimateUrl` | renovation_loan | 1 | Renovation estimate |
| `itrUrl` | working_capital_loan | 1 | ITR document |
| `gstReturnsUrl` | working_capital_loan, business_loan | 1 | GST returns |
| `dematStatementOrFdCopyUrl` | loan_against_security | 1 | Demat statement or FD copy |
| `proformaInvoiceOrQuotationUrl` | machinery_loan | 1 | Proforma invoice or quotation |

### Common File Fields

| Field Name | Max Files | Description |
|------------|-----------|-------------|
| `bankStatementUrl` | 1 | Bank statement (common for all loans) |

---

## Document Types

Additional documents can be uploaded using these field names. They will be stored in the `documents` object:

| Field Name | Description |
|------------|-------------|
| `pan_card` | PAN card document |
| `aadhaar_card` | Aadhaar card document |
| `photo` | Passport size photo |
| `itr_form_16` | ITR or Form 16 |
| `salary_slip` | Salary slip (alternative to salarySlipUrl) |
| `offer_letter` | Offer letter |
| `relieving_letter` | Relieving letter |
| `bank_statement` | Bank statement (alternative to bankStatementUrl) |
| `gst_certificate` | GST certificate |
| `gst_returns` | GST returns (alternative to gstReturnsUrl) |
| `shop_act` | Shop Act license |
| `govt_license` | Government license |

**Note:** These document fields accept only 1 file each (except where specified).

---

## Validation Rules

### 1. Field Validation
- Only fields specified in `allowedFieldsByFormType` for the selected `loanType` are allowed in `policyDetails`
- Invalid fields will return a 400 error with a list of allowed fields

### 2. Duplicate Loan Check
- Users cannot create multiple active loan queries of the same type
- Active statuses: All except `completed`, `approved`, `cancelled`
- Error: "You already have an active {loanType} loan query..."

### 3. Draft Status
- If `status` is `draft`, validation is skipped
- Draft queries can be updated
- Only draft queries can be fetched/updated via GET/PUT endpoints

### 4. Document Validation
- Document types in `documents` object must match `AllowedDocumentType` enum
- Invalid document types will return a validation error

### 5. File Upload Validation
- Files must be uploaded using the exact field names specified
- Maximum file count per field is enforced
- Supported formats: PDF, Images (JPEG, PNG, etc.)

---

## Response Format

### Success Response

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "_id": "loan_query_id",
    "customerId": "user_id",
    "loanAmount": 500000,
    "firstName": "Vikram",
    "lastName": "Patel",
    // ... other fields
    "loanType": "personal_loan",
    "status": "pending",
    "policyDetails": {
      "purpose": "Home renovation",
      "existingEmisOrLoans": "Yes, one car loan...",
      "tenure": "60",
      "salarySlipUrl": "https://s3.amazonaws.com/..."
    },
    "documents": {
      "pan_card": "https://s3.amazonaws.com/...",
      "aadhaar_card": "https://s3.amazonaws.com/...",
      "photo": "https://s3.amazonaws.com/..."
    },
    "createdAt": "2024-11-28T10:00:00.000Z",
    "updatedAt": "2024-11-28T10:00:00.000Z"
  },
  "message": "Loan query created successfully"
}
```

### Error Response

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Field(s) 'invalidField' is/are not allowed for personal_loan. Allowed fields: purpose, existingEmisOrLoans, tenure, salarySlipUrl",
  "timestamp": "2024-11-28T10:00:00.000Z",
  "path": "/api/loanquery/"
}
```

---

## Examples

### Example 1: Personal Loan (Form-Data Format)

**Postman Setup:**
- Method: `POST`
- URL: `{{baseUrl}}/api/loanquery/`
- Headers: `Authorization: Bearer <token>`
- Body Type: `form-data`

**Form Data Fields:**

**Text Fields:**
```
loanAmount: 500000
firstName: Vikram
lastName: Patel
dateOfBirth: 1985-11-08
gender: male
marriedStatus: married
mobile: 9123456789
email: vikram.patel@outlook.com
panNumber: ABCDE1234F
aadhaarNumber: 123456789012
pincode: 400053
state: Maharashtra
city: Mumbai
street: B-204, Sunrise Towers, Andheri West
employmentType: salaried
industry: IT Services
companyName: Tech Solutions Pvt Ltd
monthlyIncome: 125000
workExperience: 8
officeAddress: 501, Cyber Tower, Sector 18, Andheri East, Mumbai
bankName: HDFC Bank
accountType: salary
accountNumber: 1234567890123
ifscCode: HDFC0001234
loanType: personal_loan
status: submitted
policyDetails[purpose]: Home renovation and furniture purchase
policyDetails[existingEmisOrLoans]: Yes, one car loan EMI of ₹18,000 per month
policyDetails[tenure]: 60
```

**File Fields (select "File" type):**
- `bankStatementUrl`: [Select file]
- `salarySlipUrl`: [Select file]
- `pan_card`: [Select file]
- `aadhaar_card`: [Select file]
- `photo`: [Select file]

---

### Example 2: Education Loan (JSON Format - without files)

```json
{
  "loanAmount": 2000000,
  "firstName": "Arjun",
  "lastName": "Sharma",
  "dateOfBirth": "2003-07-15",
  "gender": "male",
  "marriedStatus": "single",
  "mobile": "9123456789",
  "email": "arjun.sharma@gmail.com",
  "panNumber": "ABCDE5678G",
  "aadhaarNumber": "987654321098",
  "pincode": "110016",
  "state": "Delhi",
  "city": "New Delhi",
  "street": "Flat 302, Green Valley Apartments, Sector 5",
  "employmentType": "salaried",
  "industry": "Education",
  "companyName": "Not Applicable",
  "monthlyIncome": 0,
  "workExperience": 0,
  "officeAddress": "Not Applicable",
  "bankName": "State Bank of India",
  "accountType": "savings",
  "accountNumber": "9876543210987",
  "ifscCode": "SBIN0001234",
  "loanType": "education_loan",
  "status": "submitted",
  "policyDetails": {
    "studentName": "Arjun Sharma",
    "courseName": "Master of Science in Computer Science",
    "instituteName": "Massachusetts Institute of Technology",
    "countryOfStudy": "United States",
    "courseDuration": "24",
    "totalCourseFee": "85000",
    "coApplicantParentName": "Rajesh Sharma",
    "tenure": "120"
  },
  "bankStatementUrl": "https://example.com/bank-statement.pdf",
  "admissionLetterUrl": "https://example.com/admission-letter.pdf",
  "feeStructureUrl": "https://example.com/fee-structure.pdf"
}
```

---

## Important Notes for Frontend Developers

1. **Always use `multipart/form-data`** - Even if not uploading files, use form-data format for consistency

2. **Nested Fields Format** - For `policyDetails`, use the format: `policyDetails[fieldName]` in form-data

3. **File Uploads** - Files are uploaded as separate form fields, not nested in objects

4. **Field Names Must Match Exactly** - Field names are case-sensitive and must match exactly as specified

5. **Loan Type Validation** - Only fields specified for the selected `loanType` are allowed in `policyDetails`

6. **Draft Status** - Use `status: "draft"` to save incomplete applications. Drafts can be updated later

7. **Customer ID** - Do NOT include `customerId` in the request. It's automatically set from the auth token

8. **Date Format** - Use `YYYY-MM-DD` format for dates

9. **Number Fields** - Can be sent as strings or numbers, but ensure they're valid numbers

10. **File Size Limits** - Check with backend team for maximum file size limits

11. **Multiple Files** - For fields that accept multiple files (like `goldPhotosUrl`, `propertyDocumentsUrl`), upload them as separate files with the same field name

12. **Error Handling** - Always check the `statusCode` and `message` in error responses for specific validation errors

---

## Testing Checklist

Before submitting to production, ensure:

- [ ] All required common fields are included
- [ ] All required loan-type-specific fields are included in `policyDetails`
- [ ] File uploads use correct field names
- [ ] `loanType` value matches exactly (e.g., `personal_loan` not `personal`)
- [ ] `employmentType` and `accountType` use valid enum values
- [ ] `gender` uses valid enum values
- [ ] Date format is `YYYY-MM-DD`
- [ ] PAN number is 10 characters, uppercase
- [ ] Aadhaar number is 12 digits
- [ ] IFSC code is 11 characters, uppercase
- [ ] Mobile number is 10 digits
- [ ] Email is valid format
- [ ] Authentication token is included in headers

---

## Support

For questions or issues, contact the backend development team.

**Last Updated:** November 2024

