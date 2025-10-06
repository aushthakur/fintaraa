export const generateOtpTemplate = (otp: string, userName = "User") => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Verify OTP</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f9f9f9;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      padding: 32px;
    }
    .title {
      font-size: 24px;
      font-weight: bold;
      color: #333;
      text-align: center;
      margin-bottom: 20px;
    }
    .message {
      font-size: 16px;
      color: #555;
      text-align: center;
      margin-bottom: 20px;
    }
    .otp-box {
      font-size: 28px;
      font-weight: bold;
      background: #f3f4f6;
      padding: 16px;
      text-align: center;
      letter-spacing: 8px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .footer {
      font-size: 14px;
      color: #999;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="title">Your Verification Code</div>
    <div class="message">Hello ${userName},<br/>Use the following code to complete your sign-in process:</div>
    <div class="otp-box">${otp}</div>
    <div class="message">This OTP is valid for 10 minutes. Please do not share it with anyone.</div>
    <div class="footer">If you didn’t request this, please ignore this email.</div>
  </div>
</body>
</html>
`;
