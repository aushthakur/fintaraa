# Insurance Query API Documentation

## Table of Contents
1. [API Overview](#api-overview)
2. [Endpoints](#endpoints)
3. [Authentication](#authentication)
4. [Request Format](#request-format)
5. [Common Fields (Required for All Insurance Types)](#common-fields-required-for-all-insurance-types)
6. [Insurance Type Specific Fields](#insurance-type-specific-fields)
7. [File Uploads](#file-uploads)
8. [Validation Rules](#validation-rules)
9. [Response Format](#response-format)
10. [Examples](#examples)

---

## API Overview

The Insurance Query API allows users to create, read, update, and delete insurance applications for various insurance types. Each insurance type has specific fields that must be provided in the `policyDetails` object.

**Base URL:** `/api/insurancequery`

**Content-Type:** `multipart/form-data` (for file uploads)

---

## Endpoints

### 1. Create Insurance Query
- **Method:** `POST`
- **URL:** `/api/insurancequery/`
- **Description:** Creates a new insurance query application
- **Authentication:** Required

### 2. Get All Insurance Queries
- **Method:** `GET`
- **URL:** `/api/insurancequery/`
- **Description:** Retrieves all insurance queries (filtered by user role)
- **Authentication:** Required

### 3. Get Insurance Query by ID
- **Method:** `GET`
- **URL:** `/api/insurancequery/:id`
- **Description:** Retrieves a specific insurance query (only draft queries can be fetched)
- **Authentication:** Required

### 4. Update Insurance Query
- **Method:** `PUT`
- **URL:** `/api/insurancequery/:id`
- **Description:** Updates an existing insurance query (only draft queries can be updated)
- **Authentication:** Required

### 5. Delete Insurance Query
- **Method:** `DELETE`
- **URL:** `/api/insurancequery/:id`
- **Description:** Deletes an insurance query
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
1. **Common Fields** - Required for all insurance types (see below)
2. **Insurance Type** - The specific insurance type (`typeOfInsurance`)
3. **Policy Details** - Insurance-specific fields (nested as `policyDetails[key]`)
4. **File Uploads** - Document files

---

## Common Fields (Required for All Insurance Types)

These fields are **mandatory** for all insurance types:

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `firstName` | String | Yes | Applicant's first name | Trimmed, required |
| `lastName` | String | Yes | Applicant's last name | Trimmed, required |
| `dateOfBirth` | Date | Yes | Date of birth | Format: `YYYY-MM-DD` |
| `gender` | String | Yes | Gender | Enum: `male`, `female`, `other`, `prefer_not_to_say` |
| `mobile` | String | Yes | Mobile number | 10 digits, trimmed |
| `email` | String | Yes | Email address | Valid email, lowercase, trimmed |
| `fullAddress` | String | Yes | Full address | Any string, trimmed |
| `city` | String | Yes | City | Any string, trimmed |
| `state` | String | Yes | State | Any string, trimmed |
| `nomineeName` | String | Yes | Nominee name | Any string, trimmed |
| `nomineeRelation` | String | Yes | Relation with nominee | Any string, trimmed |
| `occupation` | String | Yes | Occupation | Any string, trimmed |
| `annualIncome` | Number | Yes | Annual income | Must be a positive number |
| `kycDocumentType` | String | Yes | KYC document type | Enum: `pan`, `aadhaar`, `driving_license` |
| `typeOfInsurance` | String | Yes | Insurance type | See [Insurance Types](#insurance-types) |
| `status` | String | No | Application status | Default: `pending`. Enum: See [Status Values](#status-values) |
| `kycDocumentUrl` | File | Yes | KYC document file | PDF/Image file (PAN/Aadhaar/Driving License) |

---

## Insurance Types

Available insurance types (use exact values):

1. `life`
2. `health`
3. `vehicle`
4. `property`
5. `stock`
6. `machinery`
7. `term`
8. `travel`
9. `retirement`
10. `shop`

---

## Status Values

Available status values:

- `draft` - Draft application (can be updated, validation skipped)
- `pending` - Pending review (default)
- `submitted` - Submitted for review
- `under_review` - Under review
- `approved` - Approved
- `rejected` - Rejected
- `active` - Active policy
- `completed` - Completed
- `cancelled` - Cancelled
- `expired` - Expired
- `in_progress` - In progress
- `document_verification` - Document verification
- `disbursed` - Disbursed

---

## Insurance Type Specific Fields

Each insurance type has specific fields that must be provided in `policyDetails`. Use the format: `policyDetails[fieldName]`

### 1. LIFE INSURANCE (`life`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `policyType` | String | Yes | Type of life insurance policy |
| `sumAssured` | String/Number | Yes | Sum assured amount |
| `policyTerm` | String/Number | Yes | Policy term in years |
| `loanType` | String | Optional | Type of loan (if applicable) |
| `loanAmount` | String/Number | Optional | Loan amount (if applicable) |
| `loanTenure` | String/Number | Optional | Loan tenure (if applicable) |
| `lendingBankName` | String | Optional | Lending bank name (if applicable) |
| `existingLifeInsurance` | String | Yes | Details of existing life insurance |
| `medicalHistory` | String | Yes | Medical history |
| `nicotineProducts` | String | Yes | Use of nicotine products (Yes/No) |
| `healthReports` | File | Optional | Health reports document |

**Example:**
```
policyDetails[policyType]: Term Insurance
policyDetails[sumAssured]: 10000000
policyDetails[policyTerm]: 30
policyDetails[existingLifeInsurance]: No existing life insurance
policyDetails[medicalHistory]: No major medical conditions
policyDetails[nicotineProducts]: No
healthReports: [FILE]
```

---

### 2. HEALTH INSURANCE (`health`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `insuranceType` | String | Yes | Type of health insurance (Individual/Family) |
| `numberOfMembersCovered` | String/Number | Yes | Number of members covered |
| `name` | String | Yes | Name of primary member |
| `age` | String/Number | Yes | Age of primary member |
| `relation` | String | Yes | Relation (self/spouse/son/daughter/parent) |
| `healthConditionOfMember` | String | Yes | Health condition of member |
| `sumInsured` | String/Number | Yes | Sum insured amount |
| `existingMedicalConditions` | String | Yes | Existing medical conditions |
| `preExistingDiseases` | String | Yes | Pre-existing diseases |
| `hospitalPreference` | String | Yes | Preferred hospitals |
| `claimHistory` | String | Yes | Claim history |
| `medicalReports` | File | Optional | Medical reports |
| `members` | Array/Object | Optional | Array of member objects with name, age, relation, healthCondition |

**Note:** For multiple members, use `members` array. Format: `policyDetails[members][0][name]`, `policyDetails[members][0][age]`, etc.

**Example (Single Member):**
```
policyDetails[insuranceType]: Individual
policyDetails[numberOfMembersCovered]: 1
policyDetails[name]: Vikram Patel
policyDetails[age]: 39
policyDetails[relation]: self
policyDetails[healthConditionOfMember]: good
policyDetails[sumInsured]: 500000
policyDetails[existingMedicalConditions]: None
policyDetails[preExistingDiseases]: None
policyDetails[hospitalPreference]: Apollo, Fortis, Max
policyDetails[claimHistory]: No previous claims
medicalReports: [FILE]
```

**Example (Family - Multiple Members):**
```
policyDetails[insuranceType]: Family
policyDetails[numberOfMembersCovered]: 3
policyDetails[sumInsured]: 1000000
policyDetails[existingMedicalConditions]: Mother has diabetes (controlled)
policyDetails[preExistingDiseases]: None for primary members
policyDetails[hospitalPreference]: Lilavati Hospital, Kokilaben Hospital, Breach Candy Hospital
policyDetails[claimHistory]: One claim in 2022 for minor surgery - Rs. 45,000
policyDetails[members][0][name]: Vikram Patel
policyDetails[members][0][age]: 39
policyDetails[members][0][relation]: self
policyDetails[members][0][healthCondition]: good
policyDetails[members][1][name]: Sneha Patel
policyDetails[members][1][age]: 35
policyDetails[members][1][relation]: spouse
policyDetails[members][1][healthCondition]: good
policyDetails[members][2][name]: Rohan Patel
policyDetails[members][2][age]: 12
policyDetails[members][2][relation]: son
policyDetails[members][2][healthCondition]: good
medicalReports: [FILE]
```

---

### 3. VEHICLE INSURANCE (`vehicle`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `vehicleType` | String | Yes | Type of vehicle (Car, Bike, Commercial Vehicle, etc.) |
| `vehicleRegistrationNumber` | String | Yes | Vehicle registration number |
| `makeAndModel` | String | Yes | Make and model of vehicle |
| `yearOfManufacture` | String/Number | Yes | Year of manufacture |
| `fuelType` | String | Yes | Fuel type (Petrol, Diesel, Electric, CNG, etc.) |
| `chassisNumberEngineNumber` | String | Yes | Chassis number and engine number |
| `previousPolicyNumber` | String | Optional | Previous policy number (if renewal) |
| `policyExpiryDate` | String | Optional | Previous policy expiry date (if renewal) |
| `claimHistory` | String | Yes | Claim history |
| `drivingLicenseUpload` | File | Optional | Driving license document |
| `claimHistoryIfAny` | String | Optional | Detailed claim history if any |
| `rcBookUpload` | File | Optional | RC book document |
| `preferredCoverage` | String | Yes | Preferred coverage type (Comprehensive, Third Party, etc.) |

**Example:**
```
policyDetails[vehicleType]: Car
policyDetails[vehicleRegistrationNumber]: MH-01-AB-1234
policyDetails[makeAndModel]: Honda City VX
policyDetails[yearOfManufacture]: 2022
policyDetails[fuelType]: Petrol
policyDetails[chassisNumberEngineNumber]: MAJ2E123456789 / K20A1234567
policyDetails[previousPolicyNumber]: POL123456789
policyDetails[policyExpiryDate]: 2024-12-31
policyDetails[claimHistory]: No claims in last 3 years
policyDetails[preferredCoverage]: Comprehensive
drivingLicenseUpload: [FILE]
rcBookUpload: [FILE]
```

---

### 4. PROPERTY INSURANCE (`property`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `propertyType` | String | Yes | Type of property (Residential, Commercial, etc.) |
| `ownershipType` | String | Yes | Ownership type (Freehold, Leasehold, etc.) |
| `propertyAddress` | String | Yes | Property address |
| `area` | String/Number | Yes | Area in square feet |
| `constructionType` | String | Yes | Construction type (RCC, Brick, etc.) |
| `yearBuild` | String/Number | Yes | Year of construction |
| `propertyValue` | String/Number | Yes | Property value |
| `coverageRequired` | String | Yes | Coverage required |
| `propertyDocuments` | File | Optional | Property documents (can upload multiple, max 10) |

**Example:**
```
policyDetails[propertyType]: Residential
policyDetails[ownershipType]: Freehold
policyDetails[propertyAddress]: 123, MG Road, Bangalore
policyDetails[area]: 2000
policyDetails[constructionType]: RCC
policyDetails[yearBuild]: 2015
policyDetails[propertyValue]: 5000000
policyDetails[coverageRequired]: Fire, Theft, Natural Disasters
propertyDocuments: [FILE] (can upload multiple)
```

---

### 5. STOCK INSURANCE (`stock`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `businessType` | String | Yes | Type of business |
| `locationOfStock` | String | Yes | Location of stock |
| `natureOfGoodsProducts` | String | Yes | Nature of goods/products |
| `averageMonthlyStockValue` | String/Number | Yes | Average monthly stock value |
| `storageType` | String | Yes | Storage type (Warehouse, Shop, etc.) |
| `securityMeasures` | String | Yes | Security measures in place |
| `fireSafetyInstalled` | String | Yes | Fire safety measures (Yes/No) |
| `coverageRequired` | String | Yes | Coverage required |
| `stockValuationReport` | File | Optional | Stock valuation report |
| `claimHistory` | String | Yes | Claim history |
| `rcBookUpload` | File | Optional | RC book (if applicable) |

**Example:**
```
policyDetails[businessType]: Retail
policyDetails[locationOfStock]: Warehouse, Sector 18, Noida
policyDetails[natureOfGoodsProducts]: Electronics and Appliances
policyDetails[averageMonthlyStockValue]: 2000000
policyDetails[storageType]: Warehouse
policyDetails[securityMeasures]: CCTV, Security guards, Alarm system
policyDetails[fireSafetyInstalled]: Yes
policyDetails[coverageRequired]: Fire, Theft, Burglary
policyDetails[claimHistory]: No previous claims
stockValuationReport: [FILE]
```

---

### 6. MACHINERY INSURANCE (`machinery`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `machineryType` | String | Yes | Type of machinery |
| `make` | String | Yes | Make of machinery |
| `modelNo` | String | Yes | Model number |
| `serialNumber` | String | Yes | Serial number |
| `yearOfPurchase` | String/Number | Yes | Year of purchase |
| `currentMarketValue` | String/Number | Yes | Current market value |
| `usageType` | String | Yes | Usage type (Industrial, Commercial, etc.) |
| `operatingConditions` | String | Yes | Operating conditions |
| `maintenanceFrequency` | String | Yes | Maintenance frequency |
| `coverageRequired` | String | Yes | Coverage required |
| `purchaseInvoice` | File | Optional | Purchase invoice |
| `maintenanceRecord` | File | Optional | Maintenance record |

**Example:**
```
policyDetails[machineryType]: CNC Machine
policyDetails[make]: Haas
policyDetails[modelNo]: VF-2
policyDetails[serialNumber]: 123456789
policyDetails[yearOfPurchase]: 2020
policyDetails[currentMarketValue]: 3000000
policyDetails[usageType]: Industrial
policyDetails[operatingConditions]: Normal operating conditions
policyDetails[maintenanceFrequency]: Quarterly
policyDetails[coverageRequired]: Breakdown, Fire, Theft
purchaseInvoice: [FILE]
maintenanceRecord: [FILE]
```

---

### 7. TERM INSURANCE (`term`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sumAssured` | String/Number | Yes | Sum assured amount |
| `policyTerm` | String/Number | Yes | Policy term in years |
| `premiumPaymentFrequency` | String | Yes | Premium payment frequency (Monthly, Quarterly, Yearly) |
| `existingPolicies` | String | Yes | Details of existing policies |
| `medicalCheckupRequired` | String | Yes | Medical checkup required (Yes/No) |
| `medicalReportUpload` | File | Optional | Medical report |

**Example:**
```
policyDetails[sumAssured]: 5000000
policyDetails[policyTerm]: 20
policyDetails[premiumPaymentFrequency]: Yearly
policyDetails[existingPolicies]: No existing term insurance
policyDetails[medicalCheckupRequired]: Yes
medicalReportUpload: [FILE]
```

---

### 8. TRAVEL INSURANCE (`travel`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `travelType` | String | Yes | Type of travel (Domestic, International) |
| `lastName` | String | Yes | Last name (additional field) |
| `premiumPaymentFrequency` | String | Yes | Premium payment frequency |
| `existingPolicies` | String | Yes | Details of existing policies |
| `medicalCheckupRequired` | String | Yes | Medical checkup required (Yes/No) |
| `medicalReportUpload` | File | Optional | Medical report |

**Example:**
```
policyDetails[travelType]: International
policyDetails[lastName]: Patel
policyDetails[premiumPaymentFrequency]: Single Trip
policyDetails[existingPolicies]: No existing travel insurance
policyDetails[medicalCheckupRequired]: No
medicalReportUpload: [FILE]
```

---

### 9. RETIREMENT INSURANCE (`retirement`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `desiredRetirementAge` | String/Number | Yes | Desired retirement age |
| `currentAge` | String/Number | Yes | Current age |
| `currentMonthlyIncome` | String/Number | Yes | Current monthly income |
| `monthlyInvestmentCapacity` | String/Number | Yes | Monthly investment capacity |
| `preferredInvestmentType` | String | Yes | Preferred investment type |
| `nomineeDetails` | String | Yes | Nominee details |
| `existingPension` | String | Yes | Existing pension plan (Yes/No) |
| `panKycProof` | File | Optional | PAN KYC proof |

**Example:**
```
policyDetails[desiredRetirementAge]: 60
policyDetails[currentAge]: 46
policyDetails[currentMonthlyIncome]: 150000
policyDetails[monthlyInvestmentCapacity]: 50000
policyDetails[preferredInvestmentType]: Equity and Debt Mix
policyDetails[nomineeDetails]: Meera Kumar (Wife), Age 42
policyDetails[existingPension]: No existing pension plan
panKycProof: [FILE]
```

---

### 10. SHOP INSURANCE (`shop`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `shopName` | String | Yes | Shop name |
| `shopType` | String | Yes | Type of shop |
| `shopAddress` | String | Yes | Shop address |
| `shopArea` | String/Number | Yes | Shop area in square feet |
| `monthlyTurnover` | String/Number | Yes | Monthly turnover |
| `coverageType` | String | Yes | Coverage type required |
| `securitySafetyMeasures` | String | Yes | Security and safety measures |
| `shopLicense` | File | Optional | Shop license document |
| `gstCertificate` | File | Optional | GST certificate |

**Example:**
```
policyDetails[shopName]: ABC Electronics
policyDetails[shopType]: Retail Electronics
policyDetails[shopAddress]: 456, Commercial Street, Bangalore
policyDetails[shopArea]: 1500
policyDetails[monthlyTurnover]: 500000
policyDetails[coverageType]: Fire, Theft, Burglary, Public Liability
policyDetails[securitySafetyMeasures]: CCTV, Fire extinguishers, Security guards
shopLicense: [FILE]
gstCertificate: [FILE]
```

---

## File Uploads

### Insurance-Specific File Fields

These files go into `policyDetails` and are specific to certain insurance types:

| Field Name | Insurance Types | Max Files | Description |
|------------|-----------------|-----------|-------------|
| `healthReports` | life | 1 | Health reports |
| `drivingLicenseUpload` | vehicle | 1 | Driving license |
| `rcBookUpload` | vehicle, stock | 1 | RC book |
| `medicalReports` | health | 1 | Medical reports |
| `medicalReportUpload` | term, travel | 1 | Medical report |
| `propertyDocuments` | property | 10 | Property documents (can upload multiple) |
| `stockValuationReport` | stock | 1 | Stock valuation report |
| `purchaseInvoice` | machinery | 1 | Purchase invoice |
| `maintenanceRecord` | machinery | 1 | Maintenance record |
| `panKycProof` | retirement | 1 | PAN KYC proof |
| `shopLicense` | shop | 1 | Shop license |
| `gstCertificate` | shop | 1 | GST certificate |

### Common File Fields

| Field Name | Max Files | Description |
|------------|-----------|-------------|
| `kycDocumentUrl` | 1 | KYC document (PAN/Aadhaar/Driving License) - Required for all insurance types |

---

## Validation Rules

### 1. Field Validation
- Only fields specified in `allowedFieldsByFormType` for the selected `typeOfInsurance` are allowed in `policyDetails`
- Invalid fields will return a 400 error with a list of allowed fields

### 2. Duplicate Insurance Check
- Users cannot create multiple active insurance queries of the same type
- Active statuses: All except `completed`, `approved`, `cancelled`
- Error: "You already have an active {typeOfInsurance} insurance query..."

### 3. Draft Status
- If `status` is `draft`, validation is skipped
- Draft queries can be updated
- Only draft queries can be fetched/updated via GET/PUT endpoints

### 4. File Upload Validation
- Files must be uploaded using the exact field names specified
- Maximum file count per field is enforced
- Supported formats: PDF, Images (JPEG, PNG, etc.)

### 5. KYC Document Type
- `kycDocumentType` must be one of: `pan`, `aadhaar`, `driving_license`
- `kycDocumentUrl` must be provided and match the selected document type

---

## Response Format

### Success Response

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "_id": "insurance_query_id",
    "customerId": "user_id",
    "firstName": "Vikram",
    "lastName": "Patel",
    "dateOfBirth": "1985-11-08T00:00:00.000Z",
    "gender": "male",
    "mobile": "9123456789",
    "email": "vikram.patel@outlook.com",
    "fullAddress": "B-204, Sunrise Towers, Andheri West",
    "city": "Mumbai",
    "state": "Maharashtra",
    "nomineeName": "Meera Patel",
    "nomineeRelation": "mother",
    "occupation": "Business Owner",
    "annualIncome": 1500000,
    "kycDocumentType": "pan",
    "kycDocumentUrl": "https://s3.amazonaws.com/...",
    "typeOfInsurance": "health",
    "status": "submitted",
    "policyDetails": {
      "insuranceType": "family",
      "numberOfMembersCovered": "3",
      "sumInsured": "1000000",
      "existingMedicalConditions": "Mother has diabetes (controlled)",
      "preExistingDiseases": "None for primary members",
      "hospitalPreference": "Lilavati Hospital, Kokilaben Hospital, Breach Candy Hospital",
      "claimHistory": "One claim in 2022 for minor surgery - Rs. 45,000",
      "members": [
        {
          "name": "Vikram Patel",
          "age": "39",
          "relation": "self",
          "healthCondition": "good"
        },
        {
          "name": "Sneha Patel",
          "age": "35",
          "relation": "spouse",
          "healthCondition": "good"
        },
        {
          "name": "Rohan Patel",
          "age": "12",
          "relation": "son",
          "healthCondition": "good"
        }
      ],
      "medicalReports": "https://s3.amazonaws.com/..."
    },
    "createdAt": "2024-11-28T10:00:00.000Z",
    "updatedAt": "2024-11-28T10:00:00.000Z"
  },
  "message": "Insurance query created successfully"
}
```

### Error Response

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Field(s) 'invalidField' is/are not allowed for health. Allowed fields: insuranceType, numberOfMembersCovered, name, age, relation, healthConditionOfMember, sumInsured, existingMedicalConditions, preExistingDiseases, hospitalPreference, claimHistory, medicalReports, members",
  "timestamp": "2024-11-28T10:00:00.000Z",
  "path": "/api/insurancequery/"
}
```

---

## Examples

### Example 1: Health Insurance - Family Plan (Form-Data Format)

**Postman Setup:**
- Method: `POST`
- URL: `{{baseUrl}}/api/insurancequery/`
- Headers: `Authorization: Bearer <token>`
- Body Type: `form-data`

**Form Data Fields:**

**Text Fields:**
```
firstName: Vikram
lastName: Patel
dateOfBirth: 1985-11-08
gender: male
mobile: 9123456789
email: vikram.patel@outlook.com
fullAddress: B-204, Sunrise Towers, Andheri West
city: Mumbai
state: Maharashtra
nomineeName: Meera Patel
nomineeRelation: mother
occupation: Business Owner
annualIncome: 1500000
kycDocumentType: pan
typeOfInsurance: health
status: submitted
policyDetails[insuranceType]: family
policyDetails[numberOfMembersCovered]: 3
policyDetails[sumInsured]: 1000000
policyDetails[existingMedicalConditions]: Mother has diabetes (controlled)
policyDetails[preExistingDiseases]: None for primary members
policyDetails[hospitalPreference]: Lilavati Hospital, Kokilaben Hospital, Breach Candy Hospital
policyDetails[claimHistory]: One claim in 2022 for minor surgery - Rs. 45,000
policyDetails[members][0][name]: Vikram Patel
policyDetails[members][0][age]: 39
policyDetails[members][0][relation]: self
policyDetails[members][0][healthCondition]: good
policyDetails[members][1][name]: Sneha Patel
policyDetails[members][1][age]: 35
policyDetails[members][1][relation]: spouse
policyDetails[members][1][healthCondition]: good
policyDetails[members][2][name]: Rohan Patel
policyDetails[members][2][age]: 12
policyDetails[members][2][relation]: son
policyDetails[members][2][healthCondition]: good
```

**File Fields (select "File" type):**
- `kycDocumentUrl`: [Select PAN/Aadhaar/Driving License file]
- `medicalReports`: [Select medical reports file]

---

### Example 2: Retirement Insurance (Form-Data Format)

**Text Fields:**
```
firstName: Sanjay
lastName: Kumar
dateOfBirth: 1978-01-25
gender: male
mobile: 9123456789
email: sanjay.kumar@gmail.com
fullAddress: Flat 5C, Green Park Apartments, Sector 15
city: Noida
state: Uttar Pradesh
nomineeName: Meera Kumar
nomineeRelation: wife
occupation: Senior Manager
annualIncome: 1800000
kycDocumentType: pan
typeOfInsurance: retirement
status: submitted
policyDetails[desiredRetirementAge]: 60
policyDetails[currentAge]: 46
policyDetails[currentMonthlyIncome]: 150000
policyDetails[monthlyInvestmentCapacity]: 50000
policyDetails[preferredInvestmentType]: Equity and Debt Mix
policyDetails[nomineeDetails]: Meera Kumar (Wife), Age 42
policyDetails[existingPension]: No existing pension plan
```

**File Fields:**
- `kycDocumentUrl`: [Select PAN file]
- `panKycProof`: [Select PAN KYC proof file]

---

### Example 3: Vehicle Insurance (JSON Format - without files)

```json
{
  "firstName": "Rahul",
  "lastName": "Verma",
  "dateOfBirth": "1992-03-20",
  "gender": "male",
  "mobile": "9123456789",
  "email": "rahul.verma@yahoo.com",
  "fullAddress": "201, Ocean View Residency, Bandra West",
  "city": "Mumbai",
  "state": "Maharashtra",
  "nomineeName": "Priya Verma",
  "nomineeRelation": "wife",
  "occupation": "Software Engineer",
  "annualIncome": 1200000,
  "kycDocumentType": "pan",
  "typeOfInsurance": "vehicle",
  "status": "submitted",
  "policyDetails": {
    "vehicleType": "Car",
    "vehicleRegistrationNumber": "MH-01-AB-1234",
    "makeAndModel": "Honda City VX",
    "yearOfManufacture": "2022",
    "fuelType": "Petrol",
    "chassisNumberEngineNumber": "MAJ2E123456789 / K20A1234567",
    "previousPolicyNumber": "POL123456789",
    "policyExpiryDate": "2024-12-31",
    "claimHistory": "No claims in last 3 years",
    "preferredCoverage": "Comprehensive"
  },
  "kycDocumentUrl": "https://example.com/pan-card.pdf",
  "drivingLicenseUpload": "https://example.com/driving-license.pdf",
  "rcBookUpload": "https://example.com/rc-book.pdf"
}
```

---

## Important Notes for Frontend Developers

1. **Always use `multipart/form-data`** - Even if not uploading files, use form-data format for consistency

2. **Nested Fields Format** - For `policyDetails`, use the format: `policyDetails[fieldName]` in form-data

3. **Array Fields** - For arrays like `members` in health insurance, use: `policyDetails[members][0][fieldName]`, `policyDetails[members][1][fieldName]`, etc.

4. **File Uploads** - Files are uploaded as separate form fields, not nested in objects

5. **Field Names Must Match Exactly** - Field names are case-sensitive and must match exactly as specified

6. **Insurance Type Validation** - Only fields specified for the selected `typeOfInsurance` are allowed in `policyDetails`

7. **Draft Status** - Use `status: "draft"` to save incomplete applications. Drafts can be updated later

8. **Customer ID** - Do NOT include `customerId` in the request. It's automatically set from the auth token

9. **Date Format** - Use `YYYY-MM-DD` format for dates

10. **Number Fields** - Can be sent as strings or numbers, but ensure they're valid numbers

11. **File Size Limits** - Check with backend team for maximum file size limits

12. **Multiple Files** - For fields that accept multiple files (like `propertyDocuments`), upload them as separate files with the same field name

13. **KYC Document** - `kycDocumentUrl` is required and must match the `kycDocumentType` selected

14. **Error Handling** - Always check the `statusCode` and `message` in error responses for specific validation errors

---

## Testing Checklist

Before submitting to production, ensure:

- [ ] All required common fields are included
- [ ] All required insurance-type-specific fields are included in `policyDetails`
- [ ] File uploads use correct field names
- [ ] `typeOfInsurance` value matches exactly (e.g., `health` not `health_insurance`)
- [ ] `kycDocumentType` uses valid enum values (`pan`, `aadhaar`, `driving_license`)
- [ ] `gender` uses valid enum values
- [ ] Date format is `YYYY-MM-DD`
- [ ] Mobile number is 10 digits
- [ ] Email is valid format
- [ ] Authentication token is included in headers
- [ ] For health insurance with multiple members, `members` array is properly formatted
- [ ] `kycDocumentUrl` file matches the selected `kycDocumentType`

---

## Support

For questions or issues, contact the backend development team.

**Last Updated:** November 2024

