/** Send a login code by e-mail using Cloudflare Email Service. */
export async function sendLoginCode(env: Env, email: string, code: string): Promise<void> {
  if (env.LOG_OTP_CODES === "true") {
    console.log(`\n${"=".repeat(48)}\n  Login code for ${email}: ${code}\n${"=".repeat(48)}\n`)
  }
  try {
    await env.EMAIL.send({
      to: email,
      from: env.EMAIL_FROM,
      subject: `Your login code: ${code}`,
      text: `Your login code for Learning Trajectories is ${code}.\n\nIt expires in 10 minutes. If you did not request it, you can ignore this e-mail.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 16px;font-weight:600">Learning Trajectories</h2>
  <p style="margin:0 0 8px;color:#555">Your login code:</p>
  <p style="font-size:36px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,monospace;margin:0 0 16px">${code}</p>
  <p style="font-size:13px;color:#888">It expires in 10 minutes. If you did not request it, you can ignore this e-mail.</p>
</div>`,
    })
  } catch (error) {
    // Locally the e-mail binding may be unavailable; the code is logged above in that case.
    if (env.LOG_OTP_CODES !== "true") throw error
    console.warn("[auth] Sending e-mail failed:", error)
  }
}
