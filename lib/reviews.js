import { hasPostgres } from "./db/backend.js";
import * as mem from "./reviews/memory.js";
import * as pg from "./reviews/pg.js";

const dispatch = (name) => async (...args) => (hasPostgres() ? pg[name] : mem[name])(...args);

export const createReview = dispatch("createReview");
export const publishedReviews = dispatch("publishedReviews");
export const allProductStats = dispatch("allProductStats");
export const myReviews = dispatch("myReviews");
export const reviewableItems = dispatch("reviewableItems");
export const listReviewsForModeration = dispatch("listReviewsForModeration");
export const moderateReview = dispatch("moderateReview");
