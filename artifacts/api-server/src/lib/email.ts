import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendInterviewCompleteEmail({
  recruiterEmail,
  recruiterName,
  candidateName,
  jobTitle,
  overallScore,
  verdict,
  interviewId,
  frontendUrl,
}: {
  recruiterEmail: string;
  recruiterName: string;
  candidateName: string;
  jobTitle: string;
  overallScore: number;
  verdict: string;
  interviewId: number;
  frontendUrl: string;
}): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[email] SMTP not configured — skipping completion email");
    return;
  }

  const scorecardUrl = `${frontendUrl}/scorecard/${interviewId}`;

  const verdictColor =
    verdict?.toLowerCase().includes("strong hire") ? "#16A34A" :
    verdict?.toLowerCase().includes("hire") ? "#6366F1" :
    verdict?.toLowerCase().includes("maybe") ? "#D97706" : "#DC2626";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0F172A; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 20px;">
          🎯 AccionHire — Interview Completed
        </h1>
      </div>
      <div style="background: #F8FAFC; padding: 24px; border: 1px solid #E2E8F0;">
        <p style="color: #374151; font-size: 15px;">Hi ${recruiterName},</p>
        <p style="color: #374151; font-size: 15px;">
          The AI interview for <strong>${candidateName}</strong>
          for the role of <strong>${jobTitle}</strong> has been completed.
        </p>
        <div style="background: white; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="color: #64748B; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Overall Score</div>
              <div style="color: #0F172A; font-size: 32px; font-weight: 800;">${overallScore}/10</div>
            </div>
            <div style="background: ${verdictColor}22; border: 1px solid ${verdictColor}; border-radius: 8px; padding: 8px 16px;">
              <div style="color: ${verdictColor}; font-weight: 700;">${verdict}</div>
            </div>
          </div>
        </div>
        <a href="${scorecardUrl}"
          style="display: block; background: #6366F1; color: white; text-decoration: none; text-align: center; padding: 14px; border-radius: 8px; font-weight: 700; font-size: 15px;">
          View Full Scorecard →
        </a>
        <p style="color: #94A3B8; font-size: 12px; margin-top: 20px; text-align: center;">
          AccionHire — AI-powered interview platform<br>Powered by Accionlabs
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"AccionHire" <${process.env.SMTP_USER}>`,
      to: recruiterEmail,
      subject: `Interview Complete: ${candidateName} — ${jobTitle} (${overallScore}/10)`,
      html,
    });
    console.log(`[email] Completion email sent to ${recruiterEmail}`);
  } catch (err) {
    console.error("[email] Completion email error:", err);
  }
}

export async function sendCandidateInviteEmail({
  candidateEmail,
  candidateName,
  recruiterName,
  jobTitle,
  scheduledAt,
  interviewLink,
  durationMinutes,
}: {
  candidateEmail: string;
  candidateName: string;
  recruiterName: string;
  jobTitle: string;
  scheduledAt: string;
  interviewLink: string;
  durationMinutes: number;
}): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[email] SMTP not configured — skipping invite email");
    return;
  }

  const scheduledDate = new Date(scheduledAt).toLocaleString("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0F172A; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 20px;">
          📋 You're Invited for an AI Interview
        </h1>
      </div>
      <div style="background: #F8FAFC; padding: 24px; border: 1px solid #E2E8F0;">
        <p style="color: #374151; font-size: 15px;">Hi ${candidateName},</p>
        <p style="color: #374151; font-size: 15px;">
          You have been invited for an AI-powered screening interview
          for the role of <strong>${jobTitle}</strong>
          by <strong>${recruiterName}</strong>.
        </p>
        <div style="background: white; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <div style="margin-bottom: 12px;">
            <div style="color: #64748B; font-size: 12px;">Scheduled For</div>
            <div style="color: #0F172A; font-size: 16px; font-weight: 700;">${scheduledDate} IST</div>
          </div>
          <div>
            <div style="color: #64748B; font-size: 12px;">Duration</div>
            <div style="color: #0F172A; font-size: 16px; font-weight: 700;">${durationMinutes} minutes</div>
          </div>
        </div>
        <div style="background: #FEF9C3; border: 1px solid #FDE68A; border-radius: 8px; padding: 12px; margin-bottom: 20px;">
          <p style="color: #92400E; font-size: 13px; margin: 0;">
            ⏰ The interview link activates 10 minutes before your scheduled time.
            Please join on time using Google Chrome on a desktop.
          </p>
        </div>
        <a href="${interviewLink}"
          style="display: block; background: #6366F1; color: white; text-decoration: none; text-align: center; padding: 14px; border-radius: 8px; font-weight: 700; font-size: 15px;">
          Join Interview →
        </a>
        <div style="margin-top: 20px; padding: 16px; background: white; border-radius: 8px; border: 1px solid #E2E8F0;">
          <p style="color: #374151; font-size: 13px; font-weight: 700; margin-bottom: 8px;">Tips for your interview:</p>
          <ul style="color: #64748B; font-size: 13px; padding-left: 20px;">
            <li>Use Google Chrome on a laptop or desktop</li>
            <li>Find a quiet, well-lit space</li>
            <li>Allow camera and microphone access</li>
            <li>Have your resume ready for reference</li>
            <li>Be yourself — speak naturally</li>
          </ul>
        </div>
        <p style="color: #94A3B8; font-size: 12px; margin-top: 20px; text-align: center;">
          AccionHire — AI-powered interview platform<br>Powered by Accionlabs
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"AccionHire" <${process.env.SMTP_USER}>`,
      to: candidateEmail,
      subject: `Interview Invitation: ${jobTitle} at Accionlabs`,
      html,
    });
    console.log(`[email] Invite email sent to ${candidateEmail}`);
  } catch (err) {
    console.error("[email] Invite email error:", err);
  }
}
