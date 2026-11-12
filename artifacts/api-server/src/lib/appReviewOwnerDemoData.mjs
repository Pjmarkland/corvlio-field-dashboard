// Pure fixtures shared by the standalone CLI and the deployed server.
export const TARGET_EMAIL = "pjmarkland08+appreview@gmail.com";
export const DEMO_BUSINESS_NAME = "App Review Demo";
export const SEED_MARKER = "corvlio-app-review-owner-demo:v1";
export const LEAD_CALL_ID_PREFIX = "corvlio-app-review-owner-demo-v1:";

export function makeDemoLeads(now = new Date()) {
  const samples = [
    {
      callerName: "Morgan Ellis",
      phoneNumber: "+12025550100",
      issueReason: "The water heater is leaking from the lower access panel.",
      address: "742 Example Maple Avenue, Example City, FL",
      urgencyLevel: "urgent",
      availability: "Home this afternoon; call before arriving.",
      status: "new",
      minutesAgo: 24,
      contactedMinutesAgo: null,
      summary: "Fictional sample: caller reported a water-heater leak and requested a callback.",
    },
    {
      callerName: "Riley Carter",
      phoneNumber: "+12025550101",
      issueReason: "The AC runs continuously but the home is not cooling.",
      address: "18 Example Harbor Lane, Example City, FL",
      urgencyLevel: "urgent",
      availability: "Available after 2 PM.",
      status: "called_back",
      minutesAgo: 78,
      contactedMinutesAgo: 31,
      summary: "Fictional sample: owner returned the call and discussed an afternoon visit window.",
    },
    {
      callerName: "Jamie Brooks",
      phoneNumber: "+12025550102",
      issueReason: "The kitchen drain is slow and backs up during use.",
      address: "905 Example Pine Street, Example City, FL",
      urgencyLevel: "normal",
      availability: "Tomorrow morning.",
      status: "booked",
      minutesAgo: 156,
      contactedMinutesAgo: 92,
      summary: "Fictional sample: demo status marked booked; no real appointment was made.",
    },
    {
      callerName: "Avery Scott",
      phoneNumber: "+12025550103",
      issueReason: "The furnace needs its seasonal inspection and filter change.",
      address: "120 Example Spruce Way, Example City, FL",
      urgencyLevel: "low",
      availability: "Flexible next week.",
      status: "new",
      minutesAgo: 284,
      contactedMinutesAgo: null,
      summary: "Fictional sample: caller requested a routine furnace tune-up.",
    },
    {
      callerName: "Casey Nguyen",
      phoneNumber: "+12025550104",
      issueReason: "Water drips near a roof vent after heavy rain.",
      address: "44 Example Cedar Court, Example City, FL",
      urgencyLevel: "urgent",
      availability: "Someone can meet the estimator Friday.",
      status: "new",
      minutesAgo: 392,
      contactedMinutesAgo: null,
      summary: "Fictional sample: caller requested a roof-leak inspection and estimate.",
    },
    {
      callerName: "Jordan Patel",
      phoneNumber: "+12025550105",
      issueReason: "They missed a callback and asked the office to try again.",
      address: "62 Example Birch Road, Example City, FL",
      urgencyLevel: "normal",
      availability: "Call between noon and 3 PM.",
      status: "called_back",
      minutesAgo: 515,
      contactedMinutesAgo: 202,
      summary: "Fictional sample: missed-call follow-up was returned; no call was placed.",
    },
    {
      callerName: "Taylor Reed",
      phoneNumber: "+12025550106",
      issueReason: "The disposal hums but the blades do not turn.",
      address: "311 Example Willow Drive, Example City, FL",
      urgencyLevel: "normal",
      availability: "Weekdays after 1 PM.",
      status: "closed",
      minutesAgo: 695,
      contactedMinutesAgo: 604,
      summary: "Fictional sample: demo lead marked closed after a callback.",
    },
    {
      callerName: "Quinn Foster",
      phoneNumber: "+12025550107",
      issueReason: "A bathroom faucet drips when fully turned off.",
      address: "7 Example Magnolia Place, Example City, FL",
      urgencyLevel: "low",
      availability: "Any weekday morning.",
      status: "new",
      minutesAgo: 904,
      contactedMinutesAgo: null,
      summary: "Fictional sample: caller requested a faucet repair callback.",
    },
    {
      callerName: "Sam Rivera",
      phoneNumber: "+12025550108",
      issueReason: "The AC needs a seasonal tune-up before summer.",
      address: "526 Example Cypress Lane, Example City, FL",
      urgencyLevel: "normal",
      availability: "Available Thursday afternoon.",
      status: "booked",
      minutesAgo: 1210,
      contactedMinutesAgo: 1124,
      summary: "Fictional sample: demo status marked booked; no real appointment was made.",
    },
  ];

  return samples.map((lead, index) => {
    const createdAt = new Date(now.getTime() - lead.minutesAgo * 60_000);
    const contactedAt = lead.contactedMinutesAgo === null
      ? null
      : new Date(now.getTime() - lead.contactedMinutesAgo * 60_000);
    return {
      ...lead,
      retellCallId: `${LEAD_CALL_ID_PREFIX}${String(index + 1).padStart(3, "0")}`,
      summary: `${SEED_MARKER} | ${lead.summary}`,
      callerId: lead.phoneNumber,
      callbackNumber: lead.phoneNumber,
      contactedAt,
      contactedBy: contactedAt ? DEMO_BUSINESS_NAME : null,
      createdAt,
    };
  });
}
