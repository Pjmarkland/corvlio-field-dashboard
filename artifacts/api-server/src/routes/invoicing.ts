import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { databaseErrorFields } from "@workspace/db/errors";
import { requireAdmin } from "../middlewares/requireAdmin";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";
import { approveStartup, InvoiceError, markInvoicePaid, ownerInvoiceOverview, paymentInstructions } from "../invoicing/service";
import { validPaymentLink } from "../invoicing/policy";
import { runInvoiceCycle } from "../invoicing/worker";
const router = Router();
const idSchema=z.coerce.number().int().positive();
router.get("/invoicing/me",async(req,res,next) => {
  res.set("Cache-Control","private, no-store");
  const userId=getAuth(req).userId;
  if (!userId) {res.sendStatus(401);return;}
  try {
    const b=await findBusinessByClerkUserId(userId);
    if (!b) {res.sendStatus(404);return;}
    res.json(await ownerInvoiceOverview(b.id));
  } catch(e) {next(e);}
});
router.use("/admin/invoicing",requireAdmin,(_req,res,next) => {res.set("Cache-Control","private, no-store");next();});
router.get("/admin/invoicing",async(_req,res,next) => {
  try {
    const r=await pool.query<{id:number}>("SELECT id FROM businesses ORDER BY created_at DESC");
    const businesses=[];
    for (const b of r.rows) businesses.push(await ownerInvoiceOverview(b.id));
    res.json({businesses,settings:await paymentInstructions()});
  }catch(e){next(e);}
});
const settingsSchema=z.object({
  instructions:z.string().trim().max(6000),
  paymentLink:z.string().trim().max(2048).refine(validPaymentLink,"Use a secure HTTPS payment link."),
}).strict();
router.patch("/admin/invoicing/settings",async(req,res,next) => {
  const parsed=settingsSchema.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Use valid instructions and an optional HTTPS payment link."});return;}
  try {
    await pool.query(`INSERT INTO invoice_settings(id,instructions,payment_link) VALUES(1,$1,$2)
      ON CONFLICT(id) DO UPDATE SET instructions=$1,payment_link=$2,updated_at=now()`,
      [parsed.data.instructions,parsed.data.paymentLink]);
    res.json(parsed.data); void runInvoiceCycle();
  }catch(e){next(e);}
});
router.post("/admin/invoicing/:businessId/approve-startup",async(req,res,next) => {
  const id=idSchema.safeParse(req.params.businessId);
  if(!id.success){res.status(400).json({error:"Invalid business."});return;}
  try {res.json(await approveStartup(id.data));void runInvoiceCycle();}catch(e){next(e);}
});
router.post("/admin/invoicing/invoices/:invoiceId/paid",async(req,res,next) => {
  const id=idSchema.safeParse(req.params.invoiceId);
  const body=z.object({reference:z.string().trim().min(1).max(500)}).strict().safeParse(req.body);
  if(!id.success||!body.success){res.status(400).json({error:"A payment reference is required."});return;}
  try {
    res.json(await markInvoicePaid(id.data,getAuth(req).userId!,body.data.reference));
    void runInvoiceCycle();
  }catch(e){next(e);}
});
router.use((e:unknown,req:Request,res:Response,_next:NextFunction) => {
  req.log.error(databaseErrorFields(e),"Manual invoicing request failed");
  res.status(e instanceof InvoiceError ? e.status : 503).json({error:e instanceof InvoiceError ? e.message : "Invoice details are temporarily unavailable. Please try again."});
});
export default router;
