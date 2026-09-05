const BRAND = {
    name: process.env.APP_NAME || 'VtuNova',
    tagline: 'TOP UP. PAY FAST. LIVE SMART.',
    url: process.env.APP_URL || 'https://portal.example.ng',

    // VtuNova blue theme
    primary: '#123E8A',
    primaryDark: '#0F2E6D',
    secondary: '#2563EB',
    accent: '#0EA5C9',
    lightBlue: '#EFF6FF',
    border: '#DCE7F7',

    supportEmail:
        process.env.SUPPORT_EMAIL || 'support@vtuNova.com',
};

const layout = (innerHtml, { preheader = '' } = {}) => `
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >
  <meta http-equiv="X-UA-Compatible" content="IE=edge">

  <title>${BRAND.name}</title>
</head>

<body
  style="
    margin:0;
    padding:0;
    background:#EAF2FB;
    font-family:Arial, Helvetica, sans-serif;
  "
>

  <!-- Hidden inbox preview text -->
  <div
    style="
      display:none;
      max-height:0;
      overflow:hidden;
      opacity:0;
      color:transparent;
    "
  >
    ${preheader}
  </div>

  <table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="background:#EAF2FB;"
  >
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- View in browser -->
        <p
          style="
            margin:0 0 18px;
            font-size:12px;
            color:#64748B;
            line-height:18px;
          "
        >
          Having trouble viewing this email?
          <a
            href="${BRAND.url}"
            style="
              color:${BRAND.secondary};
              text-decoration:none;
              font-weight:bold;
            "
          >
            View online
          </a>
        </p>

        <!-- Main Email Container -->
        <table
          role="presentation"
          width="600"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="
            width:100%;
            max-width:600px;
            background:#FFFFFF;
            border-radius:16px;
            overflow:hidden;
            box-shadow:0 10px 35px rgba(15, 46, 109, 0.10);
          "
        >

          <!-- ================= HEADER ================= -->
          <tr>
            <td
              style="
                padding:24px 32px;
                border-bottom:2px solid ${BRAND.secondary};
                background:#FFFFFF;
              "
            >

              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
              >
                <tr>

                  <!-- Logo / Brand -->
                  <td align="left" valign="middle">

                    <a
                      href="${BRAND.url}"
                      style="text-decoration:none;"
                    >
                      <span
                        style="
                          font-size:28px;
                          font-weight:800;
                          letter-spacing:-0.5px;
                          color:${BRAND.primaryDark};
                        "
                      >
                        Vtu<span style="color:${BRAND.secondary};">Nova</span>
                      </span>
                    </a>

                    <div
                      style="
                        margin-top:4px;
                        font-size:8px;
                        font-weight:bold;
                        letter-spacing:2px;
                        color:#64748B;
                      "
                    >
                      ${BRAND.tagline}
                    </div>

                  </td>

                  <!-- Header slogan -->
                  <td
                    align="right"
                    valign="middle"
                    style="
                      font-size:13px;
                      font-weight:600;
                      color:#475569;
                    "
                  >
                    Fast. Reliable. Always
                    <span style="color:${BRAND.secondary};">
                      ON.
                    </span>
                  </td>

                </tr>
              </table>

            </td>
          </tr>


          <!-- ================= BODY ================= -->
          <tr>
            <td style="padding:36px 32px 28px;">

              ${innerHtml}

            </td>
          </tr>


          <!-- ================= FOOTER ================= -->
          <tr>
            <td
              style="
                padding:28px 32px;
                background:linear-gradient(
                  135deg,
                  ${BRAND.primaryDark},
                  ${BRAND.primary}
                );
              "
            >

              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
              >
                <tr>

                  <!-- Brand -->
                  <td
                    valign="top"
                    width="55%"
                    style="padding-right:20px;"
                  >

                    <div
                      style="
                        margin-bottom:10px;
                        font-size:24px;
                        font-weight:bold;
                        color:#FFFFFF;
                      "
                    >
                      Vtu<span style="color:#60A5FA;">Nova</span>
                    </div>

                    <p
                      style="
                        margin:0;
                        font-size:12px;
                        line-height:20px;
                        color:#CBD5E1;
                      "
                    >
                      Your all-in-one platform for airtime,
                      data, electricity bills, cable TV,
                      and more.
                    </p>

                  </td>


                  <!-- Quick Links -->
                  <td valign="top">

                    <div
                      style="
                        margin-bottom:10px;
                        font-size:13px;
                        font-weight:bold;
                        color:#FFFFFF;
                      "
                    >
                      Quick Links
                    </div>

                    <p style="margin:0 0 7px;">
                      <a
                        href="${BRAND.url}/dashboard"
                        style="
                          font-size:12px;
                          color:#CBD5E1;
                          text-decoration:none;
                        "
                      >
                        Dashboard →
                      </a>
                    </p>

                    <p style="margin:0 0 7px;">
                      <a
                        href="${BRAND.url}/transactions"
                        style="
                          font-size:12px;
                          color:#CBD5E1;
                          text-decoration:none;
                        "
                      >
                        Transaction History →
                      </a>
                    </p>

                    <p style="margin:0;">
                      <a
                        href="mailto:${BRAND.supportEmail}"
                        style="
                          font-size:12px;
                          color:#CBD5E1;
                          text-decoration:none;
                        "
                      >
                        Contact Support →
                      </a>
                    </p>

                  </td>

                </tr>
              </table>

              <!-- Divider -->
              <div
                style="
                  height:1px;
                  margin:24px 0 16px;
                  background:rgba(255,255,255,0.15);
                "
              ></div>

              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
              >
                <tr>

                  <td
                    style="
                      font-size:11px;
                      color:#CBD5E1;
                    "
                  >
                    © ${new Date().getFullYear()} ${BRAND.name}.
                    All rights reserved.
                  </td>

                  <td
                    align="right"
                    style="
                      font-size:11px;
                      color:#CBD5E1;
                    "
                  >
                    This is an automated email.
                  </td>

                </tr>
              </table>

            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;
//---------Reuseable components---------//
const heading = (text) => `
  <h1
    style="
      margin:0 0 14px;
      font-size:26px;
      line-height:34px;
      font-weight:700;
      color:#172554;
    "
  >
    ${text}
  </h1>
`;

const paragraph = (text) => `
  <p
    style="
      margin:0 0 18px;
      font-size:15px;
      line-height:25px;
      color:#475569;
    "
  >
    ${text}
  </p>
`;

const button = (label, href) => `
  <table
    role="presentation"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="margin:8px 0 24px;"
  >
    <tr>
      <td
        align="center"
        style="
          background:${BRAND.secondary};
          border-radius:8px;
        "
      >
        <a
          href="${href}"
          target="_blank"
          style="
            display:inline-block;
            padding:14px 28px;
            font-size:14px;
            font-weight:bold;
            color:#FFFFFF;
            text-decoration:none;
            border-radius:8px;
          "
        >
          ${label}
        </a>
      </td>
    </tr>
  </table>
`;


const detailBox = (rows) => `
  <table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
      margin:10px 0 24px;
      background:#F8FBFF;
      border:1px solid ${BRAND.border};
      border-radius:12px;
    "
  >
    ${rows
        .map(
            ([label, value], i) => `
        <tr>

          <td
            style="
              padding:14px 18px;
              width:45%;
              font-size:13px;
              font-weight:600;
              color:#475569;
              ${i
                    ? `border-top:1px solid ${BRAND.border};`
                    : ''
                }
            "
          >
            ${label}
          </td>

          <td
            align="right"
            style="
              padding:14px 18px;
              font-size:14px;
              font-weight:600;
              color:#172554;
              ${i
                    ? `border-top:1px solid ${BRAND.border};`
                    : ''
                }
            "
          >
            ${value}
          </td>

        </tr>
      `
        )
        .join('')}
  </table>
`;

const infoNote = (
    text,
    color = BRAND.secondary
) => `
  <table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="margin:0 0 22px;"
  >
    <tr>
      <td
        style="
          padding:14px 16px;
          background:#EFF6FF;
          border:1px solid #BFDBFE;
          border-left:4px solid ${color};
          border-radius:8px;
          font-size:13px;
          line-height:21px;
          color:#334155;
        "
      >
        ${text}
      </td>
    </tr>
  </table>
`;

const successBox = (title = 'Transaction Successful', message = '') => `
  <table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
      margin:0 0 24px;
      background:#F4F9FF;
      border:1px solid #BFDBFE;
      border-radius:12px;
    "
  >
    <tr>

      <td
        width="56"
        align="center"
        valign="middle"
        style="padding:16px 0 16px 18px;"
      >
        <div
          style="
            width:42px;
            height:42px;
            line-height:42px;
            text-align:center;
            border-radius:50%;
            background:${BRAND.secondary};
            color:#FFFFFF;
            font-size:22px;
            font-weight:bold;
          "
        >
          ✓
        </div>
      </td>

      <td style="padding:16px;">

        <div
          style="
            margin-bottom:4px;
            font-size:17px;
            font-weight:bold;
            color:${BRAND.primary};
          "
        >
          ${title}
        </div>

        ${message
        ? `
              <div
                style="
                  font-size:13px;
                  line-height:20px;
                  color:#64748B;
                "
              >
                ${message}
              </div>
            `
        : ''
    }

      </td>

    </tr>
  </table>
`;

module.exports = {
    layout,
    heading,
    paragraph,
    button,
    detailBox,
    infoNote,
    successBox,
    BRAND,
};