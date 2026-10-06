# gemini

A Claude Code plugin that lets Claude ask Google Gemini questions, for second opinions, cross-checks or code reviews.

## Tools

- `ask_gemini`: send a prompt, with optional local `files` whose contents are included, plus optional `system`, `model` and `temperature`.
- `list_gemini_models`: list the models your key can use.

## Setup

1. Get an API key at https://aistudio.google.com/apikey.
2. Make it available as `GEMINI_API_KEY`:
   - **Claude Code on the web:** add it to the environment's environment variables.
   - **Locally:** `export GEMINI_API_KEY=...` in your shell profile.
3. Install:

   ```
   claude plugin marketplace add rhys56/rhys56
   claude plugin install gemini@rhys56-plugins
   ```

The default model is `gemini-flash-latest`. Override it with `GEMINI_MODEL`, or pass `model` per call.

Requires Node 18 or later. There are no npm dependencies.
