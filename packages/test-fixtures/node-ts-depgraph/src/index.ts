import express from "express";
import type { Request, Response } from "express";

export function handleRequest(req: Request, res: Response): void {
  res.json({ ok: true });
}

export const app = express();
