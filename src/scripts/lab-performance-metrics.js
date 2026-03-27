/**
 * Lab Performance Metrics Query Script
 *
 * Run with: mongosh <connection-string> --file lab-performance-metrics.js
 * Or interactively in mongosh: load("lab-performance-metrics.js")
 *
 * Requires MongoDB 5.2+ ($top / $bottom accumulators).
 *
 * Computes per-lab and overall averages for:
 *   1. Total execution time  — gradingResult.total_execution_time (grading worker wall time, seconds)
 *   2. End-to-end latency    — completedAt - submittedAt (student submit → grading done, milliseconds)
 *
 * Only "completed" submissions with a stored gradingResult are included.
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const DB_NAME = "netgrader"; // change if your DB name differs
// ─────────────────────────────────────────────────────────────────────────────

const db = db.getSiblingDB(DB_NAME);

// Shared $match and $addFields stages reused in both pipelines
const baseStages = [
  {
    $match: {
      status: "completed",
      gradingResult: { $exists: true, $ne: null },
      completedAt: { $exists: true, $ne: null },
      submittedAt: { $exists: true, $ne: null },
    },
  },
  {
    $addFields: {
      endToEndLatencyMs: { $subtract: ["$completedAt", "$submittedAt"] },
    },
  },
];

// Shared $group accumulators for timing metrics (used in both pipelines)
const timingAccumulators = {
  submissionCount: { $sum: 1 },

  // Total execution time (seconds, from grading worker)
  avgTotalExecutionTimeSec: { $avg: "$gradingResult.total_execution_time" },
  minTotalExecutionTimeSec: { $min: "$gradingResult.total_execution_time" },
  maxTotalExecutionTimeSec: { $max: "$gradingResult.total_execution_time" },
  // jobId of the submission with the shortest execution time
  minExecJobId: {
    $top: {
      sortBy: { "gradingResult.total_execution_time": 1 },
      output: "$jobId",
    },
  },
  // jobId of the submission with the longest execution time
  maxExecJobId: {
    $bottom: {
      sortBy: { "gradingResult.total_execution_time": 1 },
      output: "$jobId",
    },
  },

  // End-to-end latency (milliseconds)
  avgEndToEndLatencyMs: { $avg: "$endToEndLatencyMs" },
  minEndToEndLatencyMs: { $min: "$endToEndLatencyMs" },
  maxEndToEndLatencyMs: { $max: "$endToEndLatencyMs" },
  // jobId of the submission with the shortest end-to-end latency
  minLatencyJobId: {
    $top: {
      sortBy: { endToEndLatencyMs: 1 },
      output: "$jobId",
    },
  },
  // jobId of the submission with the longest end-to-end latency
  maxLatencyJobId: {
    $bottom: {
      sortBy: { endToEndLatencyMs: 1 },
      output: "$jobId",
    },
  },
};

// ── 1. PER-LAB AVERAGES ──────────────────────────────────────────────────────
print("\n========================================");
print("  Per-Lab Submission Performance Metrics");
print("========================================\n");

const perLabResults = db.submissions.aggregate([
  ...baseStages,

  {
    $group: {
      _id: "$labId",
      ...timingAccumulators,
    },
  },

  // Join with labs collection to get human-readable lab title
  {
    $lookup: {
      from: "labs",
      localField: "_id",
      foreignField: "_id",
      as: "labInfo",
    },
  },
  {
    $unwind: { path: "$labInfo", preserveNullAndEmptyArrays: true },
  },

  {
    $project: {
      _id: 0,
      labId: "$_id",
      labTitle: { $ifNull: ["$labInfo.title", "Unknown Lab"] },
      submissionCount: 1,

      avgTotalExecutionTimeSec: { $round: ["$avgTotalExecutionTimeSec", 3] },
      minTotalExecutionTimeSec: { $round: ["$minTotalExecutionTimeSec", 3] },
      maxTotalExecutionTimeSec: { $round: ["$maxTotalExecutionTimeSec", 3] },
      minExecJobId: 1,
      maxExecJobId: 1,

      avgEndToEndLatencyMs: { $round: ["$avgEndToEndLatencyMs", 0] },
      avgEndToEndLatencySec: {
        $round: [{ $divide: ["$avgEndToEndLatencyMs", 1000] }, 3],
      },
      minEndToEndLatencyMs: { $round: ["$minEndToEndLatencyMs", 0] },
      maxEndToEndLatencyMs: { $round: ["$maxEndToEndLatencyMs", 0] },
      minLatencyJobId: 1,
      maxLatencyJobId: 1,
    },
  },

  { $sort: { labTitle: 1 } },
]);

perLabResults.forEach((doc) => {
  print(`Lab: ${doc.labTitle} (${doc.labId})`);
  print(`  Submissions : ${doc.submissionCount}`);
  print(`  Total Execution Time:`);
  print(`    Avg : ${doc.avgTotalExecutionTimeSec} s`);
  print(`    Min : ${doc.minTotalExecutionTimeSec} s  (jobId: ${doc.minExecJobId})`);
  print(`    Max : ${doc.maxTotalExecutionTimeSec} s  (jobId: ${doc.maxExecJobId})`);
  print(`  End-to-End Latency:`);
  print(`    Avg : ${doc.avgEndToEndLatencySec} s / ${doc.avgEndToEndLatencyMs} ms`);
  print(`    Min : ${doc.minEndToEndLatencyMs} ms  (jobId: ${doc.minLatencyJobId})`);
  print(`    Max : ${doc.maxEndToEndLatencyMs} ms  (jobId: ${doc.maxLatencyJobId})`);
  print("");
});

// ── 2. OVERALL AVERAGES (ALL LABS) ───────────────────────────────────────────
print("========================================");
print("  Overall Averages Across All Labs");
print("========================================\n");

const overallResults = db.submissions.aggregate([
  ...baseStages,

  {
    $group: {
      _id: null,
      distinctLabs: { $addToSet: "$labId" },
      ...timingAccumulators,
    },
  },

  {
    $project: {
      _id: 0,
      totalSubmissions: "$submissionCount",
      distinctLabCount: { $size: "$distinctLabs" },

      avgTotalExecutionTimeSec: { $round: ["$avgTotalExecutionTimeSec", 3] },
      minTotalExecutionTimeSec: { $round: ["$minTotalExecutionTimeSec", 3] },
      maxTotalExecutionTimeSec: { $round: ["$maxTotalExecutionTimeSec", 3] },
      minExecJobId: 1,
      maxExecJobId: 1,

      avgEndToEndLatencyMs: { $round: ["$avgEndToEndLatencyMs", 0] },
      avgEndToEndLatencySec: {
        $round: [{ $divide: ["$avgEndToEndLatencyMs", 1000] }, 3],
      },
      minEndToEndLatencyMs: { $round: ["$minEndToEndLatencyMs", 0] },
      maxEndToEndLatencyMs: { $round: ["$maxEndToEndLatencyMs", 0] },
      minLatencyJobId: 1,
      maxLatencyJobId: 1,
    },
  },
]);

overallResults.forEach((doc) => {
  print(`Total Submissions : ${doc.totalSubmissions}`);
  print(`Distinct Labs     : ${doc.distinctLabCount}`);
  print(`  Total Execution Time:`);
  print(`    Avg : ${doc.avgTotalExecutionTimeSec} s`);
  print(`    Min : ${doc.minTotalExecutionTimeSec} s  (jobId: ${doc.minExecJobId})`);
  print(`    Max : ${doc.maxTotalExecutionTimeSec} s  (jobId: ${doc.maxExecJobId})`);
  print(`  End-to-End Latency:`);
  print(`    Avg : ${doc.avgEndToEndLatencySec} s / ${doc.avgEndToEndLatencyMs} ms`);
  print(`    Min : ${doc.minEndToEndLatencyMs} ms  (jobId: ${doc.minLatencyJobId})`);
  print(`    Max : ${doc.maxEndToEndLatencyMs} ms  (jobId: ${doc.maxLatencyJobId})`);
  print("");
});

// ── 3. OPTIONAL: FILTER BY SPECIFIC LAB ─────────────────────────────────────
// Uncomment and set LAB_ID to drill into a single lab:
//
// const LAB_ID = ObjectId("your-lab-id-here");
//
// const singleLabResult = db.submissions.aggregate([
//   ...baseStages,
//   { $match: { labId: LAB_ID } },
//   {
//     $group: {
//       _id: "$labId",
//       ...timingAccumulators,
//     },
//   },
// ]);
// printjson(singleLabResult.toArray());
