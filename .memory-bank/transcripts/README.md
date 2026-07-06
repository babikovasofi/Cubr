# Transcripts

Meeting recordings, transcribed locally and diarized (who said what), live here.

## Workflow
1. Record meetings (tell participants you're recording).
2. Use the **transcribe** skill (bundled under .claude/skills/transcribe) on the
   audio/video file. On Windows/Linux it uses faster-whisper + pyannote (needs a
   HuggingFace token in .env); on Apple Silicon it uses mlx-whisper + FluidAudio.
3. The skill produces `<file>.transcript.md` with speakers labelled, then asks
   you to confirm real names.
4. Save the final transcript here, named like `meeting-YYYY-MM-DD-topic.md`.
5. Ask the agent to extract decisions into the Memory Bank.

> The raw `*.transcribe.json` cache is git-ignored.
