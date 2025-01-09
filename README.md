# Meet Transcript

This project provides a server for processing audio files, leveraging the Whisper API for transcription and Pyannote API for diarization. It's designed to handle various audio formats and return a transcript segmented by speaker.

## Features

- **Audio Transcription:** Uses the Whisper API to convert audio files into text.
- **Speaker Diarization:** Integrates with the Pyannote API to identify different speakers within the audio.
- **Multi-format Support:** Accepts common audio formats like MP3, WAV, OGG, M4A, WEBM, and MP4.
- **Automatic Conversion:** Converts non-WAV audio files to WAV format before processing.
- **Combined Output:** Returns a JSON object containing the transcript mapped to identified speakers.
- **Combine Speeches:** Combines consecutive speech segments from the same speaker into a single segment.
- **Interview Analysis:** Analyzes interview transcripts to provide insights into the candidate's skills, motivation, and communication level.

## Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/serhiikim/meet-transcript.git

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

### 1. Process Audio

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

### 2. Combine Speeches

1. **Send Request:** Send a POST request to `/combine-speeches` with the filename of a processed transcript in the request body. The filename should be the name of a file in the `results` directory.

   ```json
   {
     "filename": "your_audio_file_timestamp.json"
   }
   ```

2.  **Receive Response:** The server will respond with a JSON object indicating success and the name of the new combined file in the `results` directory.

    ```json
    {
      "success": true,
      "message": "Speeches combined successfully",
      "outputFile": "your_audio_file_timestamp_combined.json"
    }
    ```

### 3. Analyze Interview

1.  **Send Request:** Send a POST request to `/analyze-interview` with the filename of a processed transcript in the request body. The filename should be the name of a file in the `results` directory.

    ```json
    {
      "filename": "your_audio_file_timestamp.json"
    }
    ```

2.  **Receive Response:** The server will respond with a JSON object indicating success, the analysis result, and the name of the updated file in the `results` directory.

    ```json
    {
      "success": true,
      "analysis": "Analysis of the interview...",
      "updatedFile": "your_audio_file_timestamp.json"
    }
    ```

## Dependencies

- `axios`: For making HTTP requests.
- `dotenv`: For loading environment variables.
- `express`: For creating the server.
- `ffmpeg`: For audio conversion (ensure it's installed on your system).
- `form-data`: For sending form data with requests.
- `fs`: For file system operations.
- `openai`: For using the OpenAI API.

## Note

This project uses `ffmpeg` for audio conversion. Make sure you have `ffmpeg` installed on your system and available in your system's PATH. You can install it using a package manager like `apt`, `brew`, etc. depending on your operating system.
