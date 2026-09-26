# Firebase Security & Data Model

This directory defines the security architecture, permission model, and storage constraints used across the Clario ecosystem.

## Authentication & Authorization Architecture

Clario integrates Firebase Authentication alongside Cloud Firestore and Cloud Storage. The security rules in this directory enforce strict data privacy for clinical speech data:

1. User Scoping: All patient speech assessment logs, gamification progress, and learning tensors are isolated under `/users/{userId}`. A patient cannot read or modify another patient's data under any circumstance.
2. Clinical Role-Based Access: Therapists assigned to a patient's care circle can read diagnostic assessments and validated error trends, but cannot alter historical evaluation records.
3. Master Data Protection: Clinical sentence banks (`/sentence_banks/{bankId}`) are readable by authenticated users during practice sessions, but write permissions are locked to backend service account keys.
4. Audio Storage Safeguards: Storage rules restrict recording uploads to valid audio MIME types (`audio/*`) with a 15MB file size boundary, stored exclusively under the authenticated user's namespace (`/users/{userId}/recordings/{recordingId}`).

## Running a Standalone Instance

Because the production Firebase instance contains protected patient and developmental data, external evaluators and contributors running Clario locally should connect to their own Firebase project:

1. Create a Firebase project at console.firebase.google.com.
2. Enable Email/Password authentication under the Authentication tab.
3. Provision Cloud Firestore and Cloud Storage.
4. Deploy the rules from this directory using the Firebase CLI:
   firebase deploy --only firestore:rules,storage:rules
5. Copy project configuration keys into frontend/.env (see frontend/.env.example).
