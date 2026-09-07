import { getAuth } from "@clerk/express";
import {
  GetLeadsResponse,
  UpdateLeadStatusBody,
  UpdateLeadStatusParams,
  UpdateLeadStatusResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { findBusinessForClerkUser } from "../lib/businessRegistry";
import {
  GoogleSheetStatusError,
  readGoogleSheetLeads,
  writeGoogleSheetLeadStatus,
} from "../lib/googleSheets";

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
    const business = findBusinessForClerkUser(userId);
    if (!business) {
      res.json(GetLeadsResponse.parse({
        configured: false,
        businessName: null,
        timeZone: null,
        leads: [],
      }));
      return;
    }

    const { leads, timeZone } = await readGoogleSheetLeads(business.googleSheetId);
    res.json(GetLeadsResponse.parse({
      configured: true,
      businessName: business.name,
      timeZone,
      leads,
    }));
  } catch (error) {
    const status = error instanceof GoogleSheetStatusError && error.status === 429 ? 429 : 502;
    req.log.error(
      {
        status,
        error: error instanceof Error ? error.message : "Unknown Google Sheets error",
      },
      "Unable to load Google Sheet leads",
    );
    res.status(status).json({
      error: status === 429
        ? "Google Sheets is busy. Wait a moment and try again"
        : "Unable to load leads from Google Sheets",
    });
  }
});

router.patch("/leads/:leadId/status", async (req, res): Promise<void> => {
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

  const params = UpdateLeadStatusParams.safeParse(req.params);
  const body = UpdateLeadStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "A valid lead ID and status are required" });
    return;
  }

  try {
    const business = findBusinessForClerkUser(userId);
    if (!business) {
      res.status(403).json({ error: "No business is configured for this account" });
      return;
    }

    const result = await writeGoogleSheetLeadStatus(
      business.googleSheetId,
      params.data.leadId,
      body.data.status,
    );
    res.json(UpdateLeadStatusResponse.parse(result));
  } catch (error) {
    const status = error instanceof GoogleSheetStatusError ? error.status : 502;
    req.log.error(
      {
        status,
        error: error instanceof Error ? error.message : "Unknown Google Sheets error",
      },
      "Unable to update Google Sheet lead status",
    );

    const message =
      status === 404
        ? "Lead not found in the connected Google Sheet"
        : status === 409
          ? "This lead has a duplicated record ID and cannot be updated safely"
          : status === 429
            ? "Google Sheets is busy. Wait a moment and try again"
            : "Unable to update lead status in Google Sheets";
    res.status(status).json({ error: message });
  }
});

export default router;