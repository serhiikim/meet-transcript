import express from "express";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import FormData from "form-data";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supported input formats
const SUPPORTED_FORMATS = [".mp3", ".wav", ".ogg", ".m4a", ".webm", ".mp4"];

const app = express();
app.use(express.json());

// Serve static files from uploads directory
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Convert audio to WAV format
function convertToWav(inputPath) {
  const outputPath = inputPath.replace(path.extname(inputPath), ".wav");

  return new Promise((resolve, reject) => {
    const command = `ffmpeg -y -i "${inputPath}" -acodec pcm_s16le -ac 1 -ar 16000 "${outputPath}"`;

    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        console.error("Conversion error:", stderr);
        reject(error);
      } else {
        resolve(outputPath);
      }
    });
  });
}

// Transcribe audio using Whisper API
async function transcribeWithWhisper(wavFilePath) {
  const form = new FormData();
  form.append("file", fs.createReadStream(wavFilePath));
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.WHISPER_API_KEY}`,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Whisper API error:", error.response?.data || error.message);
    throw error;
  }
}

// Submit diarization job to Pyannote
async function submitDiarizationJob(wavFilePath) {
  const ngrokBaseUrl = process.env.NGROK_URL.replace(/\/$/, "");
  const publicAudioUrl = `${ngrokBaseUrl}/uploads/${encodeURIComponent(
    path.basename(wavFilePath)
  )}`;

  console.log("Sending request with URL:", publicAudioUrl);

  try {
    const response = await axios.post(
      "https://api.pyannote.ai/v1/diarize",
      {
        url: publicAudioUrl,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PYANNOTE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.jobId;
  } catch (error) {
    console.error("Pyannote API error:", error.response?.data || error.message);
    throw error;
  }
}

// Poll diarization job status
async function pollDiarizationJob(jobId) {
  const maxRetries = 30;
  const retryDelay = 10000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.get(
        `https://api.pyannote.ai/v1/jobs/${jobId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PYANNOTE_API_KEY}`,
          },
        }
      );

      if (response.data.status === "succeeded") {
        return response.data.output.diarization;
      } else if (response.data.status === "failed") {
        throw new Error("Diarization failed");
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    } catch (error) {
      console.error("Polling error:", error.response?.data || error.message);
      throw error;
    }
  }

  throw new Error("Polling timeout exceeded");
}

// Map transcription to speakers
function mapTranscriptToSpeakers(transcription, diarization) {
  console.log("Transcription data:", JSON.stringify(transcription, null, 2));
  console.log("Diarization data:", JSON.stringify(diarization, null, 2));

  const results = transcription.segments.map((segment) => {
    const speakerSegment = diarization.find(
      (s) =>
        (segment.start >= s.start && segment.start < s.end) ||
        (segment.end > s.start && segment.end <= s.end) ||
        (segment.start <= s.start && segment.end >= s.end)
    );

    return {
      speaker: speakerSegment?.speaker || "unknown",
      text: segment.text,
      start: segment.start,
      end: segment.end,
    };
  });

  console.log("Final mapped results:", JSON.stringify(results, null, 2));
  return results;
}

// Clean up temporary files
async function cleanup(...filePaths) {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.error(`Cleanup error for ${filePath}:`, error);
    }
  }
}

// Main processing endpoint
app.post("/process-audio", async (req, res) => {
  const { filename } = req.body;

  if (!filename) {
    return res
      .status(400)
      .json({ error: "Filename is required in request body" });
  }

  const inputPath = path.join(__dirname, "uploads", filename);

  // Check if file exists
  if (!fs.existsSync(inputPath)) {
    return res
      .status(404)
      .json({ error: "File not found in uploads directory" });
  }

  // Check if file format is supported
  const ext = path.extname(inputPath).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    return res.status(400).json({ error: "Unsupported file format" });
  }

  let wavPath = null;

  try {
    // Convert to WAV if needed
    if (ext !== ".wav") {
      wavPath = await convertToWav(inputPath);
    } else {
      wavPath = inputPath;
    }

    // Process with Whisper
    const transcriptionResult = await transcribeWithWhisper(wavPath);
    console.log("Whisper transcription completed");

    // Process with Pyannote
    const jobId = await submitDiarizationJob(wavPath);
    console.log("Diarization job submitted:", jobId);

    const diarizationResult = await pollDiarizationJob(jobId);
    console.log("Diarization completed");

    // Map results
    const finalResult = mapTranscriptToSpeakers(
      transcriptionResult,
      diarizationResult
    );
    console.log(
      "Mapping completed with finalResult:",
      JSON.stringify(finalResult, null, 2)
    );

    // Cleanup temporary files if needed
    if (wavPath !== inputPath) {
      await cleanup(wavPath);
    }

    res.json({
      success: true,
      result: finalResult,
    });
  } catch (error) {
    console.error("Processing error:", error);
    res.status(500).json({
      error: "Processing failed",
      details: error.message,
    });

    // Cleanup on error
    try {
      if (wavPath && wavPath !== inputPath) {
        await cleanup(wavPath);
      }
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError);
    }
  }
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
