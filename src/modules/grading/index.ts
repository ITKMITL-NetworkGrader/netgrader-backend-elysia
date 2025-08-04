import { Elysia, t } from 'elysia';
import { channel, QUEUE_NAME } from '../../config/rabbitmq';

export const gradingRoutes = new Elysia({ prefix: '/grading' })
  .post("/submit", async ({ body, set }) => {
    if (!channel) {
      set.status = 503;
      return { status: 'error', message: "Service unavailable, RabbitMQ channel not initialized." };
    }
    const jobPayload = JSON.stringify(body);
    channel.sendToQueue(QUEUE_NAME, Buffer.from(jobPayload), { persistent: true });
    return { status: 'success', message: 'Job submitted to queue' };
  },{
    body: t.Object({
      job_id: t.String(),
      instructor_id: t.String(),
      lab_name: t.String(),
      student_id: t.String(),
      topology: t.Object({
        devices: t.Array(t.Object({
          hostname: t.String(),
          ip_address: t.String(),
          connection_type: t.String(),
          platform: t.Optional(t.String()),
          username: t.Optional(t.String()),
          password: t.Optional(t.String()),
          ssh_key_path: t.Optional(t.String()),
        })),
        tests: t.Array(t.Object({
          name: t.String(),
          template: t.String(),
          vars: t.Optional(t.Record(t.String(), t.Any())),
          test_cases: t.Optional(t.Array(t.Record(t.String(), t.Any()))),
          target_device: t.Optional(t.Array(t.String())),
          expected_result: t.Optional(t.String()),
          points: t.Number()
        }))
      }),
      callback_url: t.Optional(t.String()),
      total_points: t.Number()
    }),
    detail: {
      tags: ["Grading"],
      summary: "Submit Grading Job",
      description: "Submit a grading job to the RabbitMQ queue for processing."
    }
  })
  .post("/started", async ({ body, set }) => {
    console.log(`Job Started: ${JSON.stringify(body, null, 2)}`);
    return { status: 'received', message: 'Job started successfully' };
  },
    {
        body: t.Any(),
        detail: {
            tags: ["Grading"],
            summary: "Job Started",
            description: "Receive notification when a grading job starts."
        }
    })
  .post("/progress", async ({ body, set }) => {
    const progress = body.percentage ?? 0;
    const message = body.message ?? '';
    const job_id = body.job_id ?? '';
    const current_test = body.current_test ?? '';

    console.log(`Progress for job ${job_id}: ${progress}% - ${message} (Current Test: ${current_test})`);
    set.status = 200;
    return { status: 'success', message: `Progress updated for job ${job_id}`, progress, current_test };
  },{
    body: t.Object({
      job_id: t.Optional(t.String()),
      status: t.Optional(t.String()),
      message: t.Optional(t.String()),
      current_test: t.Optional(t.String()),
      tests_completed: t.Optional(t.Number()),
      total_tests: t.Optional(t.Number()),
      percentage: t.Optional(t.Number()),
    }),
    detail: {
        tags: ["Grading"],
        summary: "Job Progress",
        description: "Receive progress updates for a grading job."
    }
  })
  .post("/notify", async ({ body }) => {

  }, {
    body: t.Object({
        message: t.String(),})
  })
  .post("/result", async ({ body, set }) => {
    const { job_id, status, total_points_earned, total_points_possible } = body;
    console.log(`Final Result for job ${job_id}: Status - ${status}, Points Earned - ${total_points_earned}/${total_points_possible}`);
    if (Array.isArray(body.test_results)) {
      for (const test_result of body.test_results) {
        const test_name = test_result.test_name ?? '';
        const test_status = test_result.status ?? '';
        const test_message = test_result.message ?? '';
        const test_points = test_result.points_earned ?? 0;
        const test_possible = test_result.points_possible ?? 0;
        const status_emoji = test_status === 'passed' ? '✅' : '❌';
        console.log(`   ${status_emoji} ${test_name}: ${test_message} (${test_points}/${test_possible} pts)`);
      }
    }
    set.status = 200;
    return { status: 'received' };
    },{
        body: t.Object({
            job_id: t.Optional(t.String()),
            status: t.Optional(t.String()),
            total_points_earned: t.Optional(t.Number()),
            total_points_possible: t.Optional(t.Number()),
            test_results: t.Optional(t.Array(t.Object({
                test_name: t.String(),
                status: t.String(),
                message: t.String(),
                points_earned: t.Number(),
                points_possible: t.Number(),
                execution_time: t.Optional(t.Number()),
                raw_output: t.Optional(t.String()),
            }))),
            total_execution_time: t.Optional(t.Number()),
            error_message: t.Optional(t.String()),
            created_at: t.Optional(t.String()),
            compleated_at: t.Optional(t.String()),

        }),
        detail: {
            tags: ["Grading"],
            summary: "Job Result",
            description: "Receive the final result of a grading job."
        }
    });