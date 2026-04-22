import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth";
import { logger } from "./logger";

export async function seedDefaultUsers(): Promise<void> {
  try {
    const defaults = [
      { email: "admin@accionhire.com", password: "Admin@123", name: "Admin User", role: "admin" as const },
      { email: "recruiter@accionhire.com", password: "Recruiter@123", name: "Recruiter User", role: "recruiter" as const },
    ];

    for (const u of defaults) {
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, u.email));
      if (!existing) {
        await db.insert(usersTable).values({
          email: u.email,
          password: await hashPassword(u.password),
          name: u.name,
          role: u.role,
        });
      }
    }

    logger.info("✓ Default users ready: admin@accionhire.com");
  } catch (err) {
    logger.error({ err }, "Failed to seed default users");
  }
}
