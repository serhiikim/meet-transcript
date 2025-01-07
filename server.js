import express from "express";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import FormData from "form-data";
import OpenAI from 'openai';



dotenv.config();

// Initialize OpenAI client (add after other initializations)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supported input formats
const SUPPORTED_FORMATS = [".mp3", ".wav", ".ogg", ".m4a", ".webm", ".mp4"];

const app = express();
app.use(express.json());

// Serve static files from uploads directory
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Create results directory if it doesn't exist
const resultsDir = path.join(__dirname, "results");
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir);
}

// Function to save results to JSON file
async function saveResultToJson(filename, data) {
  const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
  const resultFilename = `${path.parse(filename).name}_${timestamp}.json`;
  const resultPath = path.join(resultsDir, resultFilename);
  
  const resultData = {
    originalFile: filename,
    processedAt: new Date().toISOString(),
    transcription: data
  };

  try {
    await fs.promises.writeFile(resultPath, JSON.stringify(resultData, null, 2), 'utf8');
    console.log(`Results saved to: ${resultPath}`);
    return resultFilename;
  } catch (error) {
    console.error('Error saving results:', error);
    throw error;
  }
}

// [Previous functions remain unchanged]
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

async function transcribeWithWhisper(filePath) {
  const stats = await fs.promises.stat(filePath);
  const fileSizeInMB = stats.size / (1024 * 1024);
  
  if (fileSizeInMB > 25) {
    // Split into chunks if file is too large
    const chunks = await splitAudioIntoChunks(filePath);
    let combinedTranscription = {
      segments: []
    };
    
    for (const [index, chunk] of chunks.entries()) {
      const form = new FormData();
      form.append("file", fs.createReadStream(chunk));
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
        
        // Adjust timestamps for segments
        const timeOffset = index * 600; // 10 minutes in seconds
        response.data.segments.forEach(segment => {
          segment.start += timeOffset;
          segment.end += timeOffset;
        });
        
        combinedTranscription.segments.push(...response.data.segments);
      } catch (error) {
        console.error(`Error transcribing chunk ${index + 1}:`, error.response?.data || error.message);
        throw error;
      } finally {
        // Clean up chunk file
        try {
          await fs.promises.unlink(chunk);
        } catch (err) {
          console.error(`Error deleting chunk ${chunk}:`, err);
        }
      }
    }
    
    // Clean up chunks directory if empty
    try {
      const chunksDir = path.join(__dirname, 'temp_chunks');
      const remainingFiles = await fs.promises.readdir(chunksDir);
      if (remainingFiles.length === 0) {
        await fs.promises.rmdir(chunksDir);
      }
    } catch (err) {
      console.error('Error cleaning up chunks directory:', err);
    }
    
    return combinedTranscription;
  } else {
    // Original code for files under 25MB
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
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
}

function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    const command = `ffprobe -i "${filePath}" -show_entries format=duration -v quiet -of csv="p=0"`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(parseFloat(stdout.trim()));
      }
    });
  });
}

// Function to split audio into chunks
async function splitAudioIntoChunks(inputPath, chunkDuration = 600) { // 10 minutes chunks by default
  const duration = await getAudioDuration(inputPath);
  const chunks = [];
  const outputDir = path.join(__dirname, 'temp_chunks');
  
  // Create temp directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  for (let start = 0; start < duration; start += chunkDuration) {
    const chunkPath = path.join(outputDir, `chunk_${start}_${path.parse(inputPath).name}.wav`);
    const command = `ffmpeg -y -i "${inputPath}" -ss ${start} -t ${chunkDuration} -acodec pcm_s16le -ac 1 -ar 16000 "${chunkPath}"`;
    
    await new Promise((resolve, reject) => {
      exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          chunks.push(chunkPath);
          resolve();
        }
      });
    });
  }
  
  return chunks;
}

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
        numSpeakers: 2
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

function mapTranscriptToSpeakers(transcription, diarization) {
  // console.log("Transcription data:", JSON.stringify(transcription, null, 2));
  // console.log("Diarization data:", JSON.stringify(diarization, null, 2));

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

//  console.log("Final mapped results:", JSON.stringify(results, null, 2));
  return results;
}

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

function combineConsecutiveSpeeches(inputPath) {
  // Read the input file
  const rawData = fs.readFileSync(inputPath, 'utf8');
  const data = JSON.parse(rawData);
  
  // Initialize the array for combined speeches
  const combinedTranscription = [];
  let currentSpeech = null;
  
  // Process each segment
  data.transcription.forEach((segment) => {
    if (!currentSpeech) {
      // First segment
      currentSpeech = { ...segment };
    } else if (currentSpeech.speaker === segment.speaker) {
      // Same speaker - combine speeches
      currentSpeech.text += ' ' + segment.text.trim();
      currentSpeech.end = segment.end;
    } else {
      // Different speaker - save current and start new
      combinedTranscription.push(currentSpeech);
      currentSpeech = { ...segment };
    }
  });
  
  // Don't forget to add the last speech
  if (currentSpeech) {
    combinedTranscription.push(currentSpeech);
  }
  
  // Prepare the output data
  const outputData = {
    originalFile: data.originalFile,
    processedAt: new Date().toISOString(),
    originalProcessedAt: data.processedAt,
    transcription: combinedTranscription
  };
  
  // Generate output filename
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const basename = path.basename(inputPath, ext);
  const outputPath = path.join(dir, `${basename}_combined${ext}`);
  
  // Write the output file
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
  
  return outputPath;
}

// Add endpoint for combining speeches
app.post('/combine-speeches', async (req, res) => {
  const { filename } = req.body;
  
  if (!filename) {
    return res.status(400).json({ error: 'Filename is required in request body' });
  }
  
  const inputPath = path.join(__dirname, 'results', filename);
  
  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'File not found in results directory' });
  }
  
  try {
    const outputPath = combineConsecutiveSpeeches(inputPath);
    res.json({
      success: true,
      message: 'Speeches combined successfully',
      outputFile: path.basename(outputPath)
    });
  } catch (error) {
    console.error('Error combining speeches:', error);
    res.status(500).json({
      error: 'Processing failed',
      details: error.message
    });
  }
});


app.post('/analyze-interview', async (req, res) => {
  const { filename } = req.body;
  
  if (!filename) {
    return res.status(400).json({ error: 'Filename is required in request body' });
  }
  
  const inputPath = path.join(__dirname, 'results', filename);
  
  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'File not found in results directory' });
  }
  
  try {
    // Read and parse the interview transcript
    const rawData = await fs.promises.readFile(inputPath, 'utf8');
    const data = JSON.parse(rawData);
    
    // Format the transcript for the prompt
    const formattedTranscript = data.transcription
      .map(segment => `${segment.speaker}: ${segment.text}`)
      .join('\n');
    
    // Create the analysis prompt
    const prompt = `Below is a technical interview transcript. 
    
${formattedTranscript}

Using the information provided by the candidate on the interview provide information about the following:
* the task that the candidate was solving with their technical challenges and solutions (summary)
* The strong skills of the engineer
* The candidate's motivation
* What is the communication level of the engineer?
* What might be improved by the candidate.`;

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7
    });

    // Get the analysis result
    const analysisResult = completion.choices[0].message.content;
    
    // Update the existing file with the analysis
    const updatedData = {
      ...data,
      summary: analysisResult
    };
    
    // Save back to the same file
    await fs.promises.writeFile(inputPath, JSON.stringify(updatedData, null, 2), 'utf8');
    
    res.json({
      success: true,
      analysis: analysisResult,
      updatedFile: filename
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      error: 'Analysis failed',
      details: error.message
    });
  }
});

// Updated main processing endpoint
app.post("/process-audio", async (req, res) => {
  const { filename } = req.body;

  if (!filename) {
    return res
      .status(400)
      .json({ error: "Filename is required in request body" });
  }

  const inputPath = path.join(__dirname, "uploads", filename);

  if (!fs.existsSync(inputPath)) {
    return res
      .status(404)
      .json({ error: "File not found in uploads directory" });
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    return res.status(400).json({ error: "Unsupported file format" });
  }

  let wavPath = null;

  try {
    if (ext !== ".wav") {
      wavPath = await convertToWav(inputPath);
    } else {
      wavPath = inputPath;
    }

    const transcriptionResult = await transcribeWithWhisper(wavPath);
    console.log("Whisper transcription completed");

    const jobId = await submitDiarizationJob(wavPath);
    console.log("Diarization job submitted:", jobId);

    const diarizationResult = await pollDiarizationJob(jobId);
    console.log("Diarization completed");

    const finalResult = mapTranscriptToSpeakers(
      transcriptionResult,
      diarizationResult
    );
    // console.log(
    //   "Mapping completed with finalResult:",
    //   JSON.stringify(finalResult, null, 2)
    // );

    // Save results to JSON file
    const savedFilename = await saveResultToJson(filename, finalResult);

    if (wavPath !== inputPath) {
      await cleanup(wavPath);
    }

    res.json({
      success: true,
      result: finalResult,
      savedFile: savedFilename
    });
  } catch (error) {
    console.error("Processing error:", error);
    res.status(500).json({
      error: "Processing failed",
      details: error.message,
    });

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