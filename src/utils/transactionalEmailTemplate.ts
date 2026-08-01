type TransactionalEmailAction = {
  label: string;
  href: string;
};

export const escapeEmailHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const renderLightTransactionalEmail = ({
  preheader,
  eyebrow,
  title,
  body,
  action,
}: {
  preheader: string;
  eyebrow: string;
  title: string;
  body: string;
  action?: TransactionalEmailAction;
}) => {
  const safeActionHref = action ? escapeEmailHtml(action.href) : "";

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeEmailHtml(title)} | Fintaraa</title>
  </head>
  <body style="margin:0;background-color:#eef4f8;padding:0;font-family:Arial,Helvetica,sans-serif;color:#1d2939;color-scheme:light">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
      ${escapeEmailHtml(preheader)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#eef4f8">
      <tr>
        <td align="center" style="padding:32px 12px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;border:1px solid #d7e4ec;border-radius:16px;background-color:#ffffff;box-shadow:0 8px 24px rgba(15,67,99,0.08)">
            <tr>
              <td height="6" style="height:6px;border-radius:16px 16px 0 0;background-color:#0b72b9;font-size:0;line-height:0">&nbsp;</td>
            </tr>
            <tr>
              <td style="border-bottom:1px solid #e4edf3;background-color:#ffffff;padding:22px 30px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td valign="middle">
                      <div style="font-size:25px;font-weight:800;letter-spacing:-0.5px;color:#114d76">Fintaraa<span style="color:#19a974">.</span></div>
                      <div style="margin-top:3px;font-size:11px;font-weight:700;letter-spacing:1.1px;color:#667085">SMARTER FINANCIAL JOURNEYS</div>
                    </td>
                    <td align="right" valign="middle" style="padding-left:12px">
                      <span style="display:inline-block;border:1px solid #cfe4f3;border-radius:999px;background-color:#f0f8fd;padding:7px 11px;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#176a9f">SERVICE UPDATE</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color:#ffffff;padding:34px 30px 30px;font-size:15px;line-height:1.7;color:#344054">
                <div style="margin-bottom:10px;font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#0b72b9">${escapeEmailHtml(eyebrow)}</div>
                <h1 style="margin:0 0 22px;font-size:26px;line-height:1.25;letter-spacing:-0.4px;color:#102a43">${escapeEmailHtml(title)}</h1>
                ${body}
                ${
                  action
                    ? `<div style="padding-top:10px">
                         <a href="${safeActionHref}" style="display:inline-block;border-radius:9px;background-color:#0b72b9;padding:13px 21px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">${escapeEmailHtml(action.label)}</a>
                       </div>
                       <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#667085">Button not opening? <a href="${safeActionHref}" style="color:#0b72b9;text-decoration:underline">Open the secure link</a>.</p>`
                    : ""
                }
                <div style="margin-top:24px;border:1px solid #f0ddb0;border-radius:10px;background-color:#fffaf0;padding:13px 15px;font-size:12px;line-height:1.65;color:#6b5525">
                  <strong style="color:#5b4619">Security reminder</strong><br />
                  Fintaraa will never ask for your OTP, PIN, CVV, card password, or internet-banking password over email, call, SMS, or WhatsApp.
                </div>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e4edf3;border-radius:0 0 16px 16px;background-color:#f8fbfd;padding:20px 30px;font-size:12px;line-height:1.7;color:#667085">
                <strong style="color:#344054">Team Fintaraa</strong><br />
                This is a service notification related to your application.<br />
                Need help? <a href="mailto:customercare@fintaraa.com" style="color:#0b72b9;text-decoration:none">customercare@fintaraa.com</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};
