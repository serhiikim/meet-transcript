# Meet Transcript

This project provides a server for processing audio files, leveraging the Whisper API for transcription and Pyannote API for diarization. It's designed to handle various audio formats and return a transcript segmented by speaker.

## Features

- **Audio Transcription:** Uses the Whisper API to convert audio files into text.
- **Speaker Diarization:** Integrates with the Pyannote API to identify different speakers within the audio.
- **Multi-format Support:** Accepts common audio formats like MP3, WAV, OGG, M4A, WEBM, and MP4.
- **Automatic Conversion:** Converts non-WAV audio files to WAV format before processing.
- **Combined Output:** Returns a JSON object containing the transcript mapped to identified speakers.

## Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/your-username/meet-transcript.git

   ```

2. **Install dependencies:**

   ```bash
   cd meet-transcript
   npm install

   ```

3. **Configuration:**

   Create a `.env` file in the root directory and add the following environment variables:

   ```
   OPENAI_API_KEY=<your_openai_api_key>
   PYANNOTE_API_KEY=<your_pyannote_api_key>
   NGROK_URL=<your_ngrok_url>
   PORT=<your_desired_port> (optional, defaults to 3000)

   - `OPENAI_API_KEY`: Your API key for the OPENAI API.
   - `PYANNOTE_API_KEY`: Your API key for the Pyannote API.
   - `NGROK_URL`: Your ngrok URL for exposing the uploads directory to Pyannote.  Make sure your ngrok tunnel points to the `uploads` directory.  For example, if your project is running locally on port 3000, you would run: `ngrok http 3000 -subdomain=your-subdomain --host-header="localhost:3000"` and then set `NGROK_URL` to `https://your-subdomain.ngrok.io`.
   - `PORT`: The port you want the server to run on (optional).

   ```

4. **Start the server:**
   ```bash
   npm start
   ```

## Usage

1. **Upload Audio:** Upload your audio file to the `uploads` directory. You can do this manually, or through a file upload mechanism if you implement one in a frontend application.

2. **Send Request:** Send a POST request to `/process-audio` with the filename in the request body:

   ```json
   {
     "filename": "your_audio_file.mp3"
   }
   ```

3. **Receive Response:** The server will respond with a JSON object containing the transcribed text mapped to speakers:
   ```json
   {
     "success": true,
     "result": [
       {
         "speaker": "A",
         "text": "Hello, how are you?",
         "start": 0.0,
         "end": 2.5
       },
       {
         "speaker": "B",
         "text": "I'm doing well, thank you.",
         "start": 2.5,
         "end": 5.0
       }
     ]
   }
   ```

## Dependencies

- `@google-cloud/speech`: Although listed in `package.json`, it is not used in the current code. Consider removing it.
- `axios`: For making HTTP requests.
- `dotenv`: For loading environment variables.
- `express`: For creating the server.
- `ffmpeg`: For audio conversion (ensure it's installed on your system).
- `form-data`: For sending form data with requests.
- `fs`: For file system operations.
- `multer`: Although listed in `package.json`, it is not used in the current code. Consider removing it.
- `raw-body`: Although listed in `package.json`, it is not used in the current code. Consider removing it.

## Note

This project uses `ffmpeg` for audio conversion. Make sure you have `ffmpeg` installed on your system and available in your system's PATH. You can install it using a package manager like `apt`, `brew`, etc. depending on your operating system.
