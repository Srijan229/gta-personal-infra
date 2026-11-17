// Two owned records for the portfolio demonstration; never touches applicants.
const prisma = require("./src/db");
async function main() {
  const db = new URL(process.env.DATABASE_URL).pathname;
  if (!["/gta_personal_k8s", "/gta_rehearsal"].includes(db))
    throw Error("Demo database guard failed");
  const open = process.argv[2] === "open";
  if (!["open", "close"].includes(process.argv[2]))
    throw Error("Use open or close");
  await prisma.$transaction([
    prisma.applicationPhase.upsert({
      where: { id: "portfolio-demo-phase" },
      create: {
        id: "portfolio-demo-phase",
        phaseName: "Master's",
        isActive: open,
      },
      update: { isActive: open },
    }),
    prisma.importedSection.upsert({
      where: { id: "portfolio-demo-section" },
      create: {
        id: "portfolio-demo-section",
        crn: "DEMO-ONLY",
        course: "IT 102",
        courseTitle: "Fictional portfolio demonstration",
        section: "DEMO",
        term: "Fall 2026",
        courseTerm: "IT 102 Fall 2026",
        activeStatus: true,
      },
      update: {},
    }),
  ]);
  console.log("Portfolio application window: " + (open ? "open" : "closed"));
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
