import { getAuth } from "@clerk/express";
import { GetLeadsResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { readGoogleSheetLeads } from "../lib/googleSheets";

const router: IRouter = Router();

router.get("/leads", async (req, res): Promise<void> => {
  res.set({
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    Pragma: "no-cache",
  });
  res.vary("Cookie");

  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const leads = await readGoogleSheetLeads();
    res.json(GetLeadsResponse.parse(leads));
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown Google Sheets error" },
      "Unable to load Google Sheet leads",
    );
    res.status(502).json({ error: "Unable to load leads from Google Sheets" });
  }
});

export default router;