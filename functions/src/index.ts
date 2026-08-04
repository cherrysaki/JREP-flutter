/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

admin.initializeApp();

type IncomingRecord = {
  source: "FocusStatus";
  timestamp: string;
  isFocused?: boolean;
  subjectId: string;
};

export const importFromSheet = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const records = (req.body?.records ?? []) as IncomingRecord[];

    if (!Array.isArray(records) || records.length === 0) {
      res.status(200).send({ ok: true, count: 0 });
      return;
    }

    const db = admin.firestore();
    const batch = db.batch();

    for (const r of records) {
      if (!r.timestamp || !r.source || !r.subjectId) continue;

      const ts = new Date(r.timestamp);
      if (Number.isNaN(ts.getTime())) continue;

      const docId = `${r.subjectId}_${r.source}_${ts.toISOString()}`;
      const ref = db.collection("focusFlag").doc(docId);

      batch.set(
        ref,
        {
          subjectId: r.subjectId,
          source: r.source,
          isFocused: Boolean(r.isFocused),
          timestamp: admin.firestore.Timestamp.fromDate(ts),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    res.status(200).send({ ok: true, count: records.length });
  } catch (e) {
    console.error("importFromSheet error", e);
    res.status(500).send({ error: "failed" });
  }
});


const GAS_WEBAPP_URL = process.env.GAS_WEBAPP_URL;

async function postToGAS(payload: any) {
  if (!GAS_WEBAPP_URL) {
    throw new Error("GAS_WEBAPP_URL is not set");
  }

  const res = await fetch(GAS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export const exportPreSurvey =
  onDocumentCreated(
    {
      document: "preSurvey/{docId}",
      region: "us-central1",
    },
    async (event) => {
      const snap = event.data;
      if (!snap) return;

      const d = snap.data();
      if (!d) return;

      await postToGAS({
        sheet: "PreSurvey",
        subjectId: d.subjectId,
        sessionId: d.sessionId,
        createdAt: d.createdAt?.toDate().toISOString(),

        // basic
        age: d.payload?.basic?.age ?? "",
        gender: d.payload?.basic?.gender ?? "",
        handedness: d.payload?.basic?.handedness ?? "",
        gradeOrAffiliation: d.payload?.basic?.gradeOrAffiliation ?? "",
        sleepDurationYesterdayHours: d.payload?.basic?.sleepDurationYesterdayHours ?? "",
        sleepQuality: d.payload?.basic?.sleepQuality ?? "",
        mealsAndTimes: d.payload?.basic?.mealsAndTimes ?? "",
        caffeineIntake: d.payload?.basic?.caffeineIntake ?? "",
        alcoholYesterday: d.payload?.basic?.alcoholYesterday ?? "",
        currentDiseases: d.payload?.basic?.currentDiseases ?? "",
        medications: d.payload?.basic?.medications ?? "",
        exerciseHabit: d.payload?.basic?.exerciseHabit ?? "",
        focusChronotype: d.payload?.basic?.focusChronotype ?? "",

        // mental
        physicalCondition: d.payload?.mental?.physicalCondition ?? "",
        sleepInsufficiency: d.payload?.mental?.sleepInsufficiency ?? "",
        stressLevel: d.payload?.mental?.stressLevel ?? "",
        fatigueAwareness: d.payload?.mental?.fatigueAwareness ?? "",
        eyeStrain: d.payload?.mental?.eyeStrain ?? "",
        physicalDiscomfort: d.payload?.mental?.physicalDiscomfort ?? "",

        // free
        distractionFactors: d.payload?.free?.distractionFactors ?? "",
        effectiveBreakStyle: d.payload?.free?.effectiveBreakStyle ?? "",
      });
    }
  );

export const exportAfterWorkSurvey =
  onDocumentCreated(
    {
      document: "afterWorkSurvey/{docId}",
      region: "us-central1",
    },
    async (event) => {
      const snap = event.data;
      if (!snap) return;

      const d = snap.data();
      if (!d) return;

      await postToGAS({
        sheet: "AfterWorkSurvey",
        subjectId: d.subjectId,
        sessionId: d.sessionId,
        count: d.count,
        concentration: d.concentration,
        fatigue: d.fatigue,
        comfort: d.comfort,
        createdAt: d.createdAt?.toDate().toISOString(),
      });
    }
  );

  export const exportAfterBreakSurvey =
  onDocumentCreated(
    {
      document: "afterBreakSurvey/{docId}",
      region: "us-central1",
    },
    async (event) => {
      const snap = event.data;
      if (!snap) return;

      const d = snap.data();
      if (!d) return;

      await postToGAS({
        sheet: "AfterBreakSurvey",
        subjectId: d.subjectId,
        sessionId: d.sessionId,
        count: d.count,
        activity: d.activity,
        recovery: d.recovery,
        breakDuration: d.breakDuration,
        createdAt: d.createdAt?.toDate().toISOString(),
      });
    }
  );



// export const forwardPreSurveyToGas = functions.firestore
//   .document("preSurvey/{docId}")
//   .onCreate(async (snap, context) => {
//     const gasUrl = process.env.GAS_WEBAPP_URL;

//     if (!gasUrl) {
//       console.error("GAS_WEBAPP_URL is not set");
//       return;
//     }

//     const docId = context.params.docId;
//     const data = snap.data();

//     if (!data) {
//       console.log("skip: empty preSurvey document", docId);
//       return;
//     }

//     const payload = {
//       collection: "preSurvey",
//       docId,
//       createdAt: data.createdAt ?? null,
//       subjectId: data.subjectId ?? null,
//       sessionId: data.sessionId ?? null,
//       source: data.source ?? null,
//       payload: data.payload ?? data,
//     };

//     try {
//       const resp = await fetch(gasUrl, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify(payload),
//       });

//       const text = await resp.text();
//       console.log("forwardPreSurveyToGas status:", resp.status);
//       console.log("forwardPreSurveyToGas body:", text);

//       if (!resp.ok) {
//         throw new Error(`GAS responded with ${resp.status}: ${text}`);
//       }
//     } catch (e) {
//       console.error("forwardPreSurveyToGas error", e);
//     }
//   });


// export const forwardpreSurveyToGas = onDocumentCreated(
//   "preSurvey/{docId}",
//   async (event) => {
//     const data = event.data?.data();
//     if (!data?.subjectId || !data?.sessionId || !data?.source) {
//       console.log("skip: invalid preSurvey  document", data);
//       return;
//     }

//     const payload = {
//       collection: "preSurvey",
//       createdAt: data.createdAt ?? null,
//       subjectId: data.subjectId,
//       sessionId: data.sessionId,
//       source: data.source,
//       payload: data.payload ?? {},
//     };

//     const res = await fetch(process.env.GAS_WEBAPP_URL!, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(payload),
//     });

//     const text = await res.text();
//     console.log("GAS response:", res.status, text);

//     if (!res.ok) {
//       throw new Error(`Failed to POST to GAS: ${res.status} ${text}`);
//     }
//   }
// );




// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
// setGlobalOptions({ maxInstances: 10 });

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
