const prisma = require("./src/db");
require("./src/lib/interviewExpiry")
  .expireStaleInterviews(prisma)
  .then((count) => console.log("Expired interviews: " + count))
  .catch(() => {
    console.error("Expiry job failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
