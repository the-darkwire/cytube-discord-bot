import CytubeClient from "cytube-client";
import { env } from "../config";

export const createCytubeClient = async () =>
  CytubeClient.connect(env.CYTUBE_CHANNEL);
