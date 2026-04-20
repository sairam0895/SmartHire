import { db, usersTable } from "@workspace/db";
import { count } from "drizzle-orm";
import { hashPassword } from "./auth";
import { logger } from "./logger";

export async function seedDefaultUsers(): Promise<void> {
  try {
    const [result] = await db.select({ count: count() }).from(usersTable);
    if ((result?.count ?? 0) > 0) return;

    await db.insert(usersTable).values([
      {
        email: "admin@accionhire.com",
        password: await hashPassword("Admin@123"),
        name: "Admin User",
        role: "admin",
      },
      {
        email: "recruiter@accionhire.com",
        password: await hashPassword("Recruiter@123"),
        name: "Recruiter User",
        role: "recruiter",
      },
    ]);

    logger.info("Default users seeded: admin@accionhire.com + recruiter@accionhire.com");
  } catch (err) {
    logger.error({ err }, "Failed to seed default users");
  }
}
