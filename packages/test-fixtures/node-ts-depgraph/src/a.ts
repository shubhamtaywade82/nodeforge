import express from "express";
import { z } from "zod";
import { helperB } from "./b.js";

export function createApp(): express.Express {
  const app = express();
  const schema = z.object({ name: z.string() });
  app.get("/", (req, res) => {
    res.json({ schema, helper: helperB() });
  });
  return app;
}
