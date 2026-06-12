import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

// Helper for Vercel/Serverless compatible writable folder
const getEnterpriseDir = (): string => {
  return process.env.VERCEL 
    ? path.join("/tmp", "enterprise-source")
    : path.join(process.cwd(), "enterprise-source");
};

// 1. Core State Store (Stateful Memory-Store)
let codeTasks: any[] = [];
let taskFiles: any[] = [];
let taskConflicts: any[] = [];
let aiRecommendations: any[] = [];

// 2. Initialize Express
const app = express();
app.use(express.json());

// Initialize Gemini API
const geminiApiKey = process.env.GEMINI_API_KEY || "";
let ai: GoogleGenAI | null = null;
if (geminiApiKey) {
  try {
    ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
    console.log("Initialized server-side Gemini API client seamlessly.");
  } catch (ex) {
    console.error("Gemini API init crash: ", ex);
  }
}

// 3. Difference Detection Engine Utility
function detectDifferences(base: string, modified: string) {
  const baseLines = base.split('\n');
  const modLines = modified.split('\n');
  const maxLines = Math.max(baseLines.length, modLines.length);
  const result: any[] = [];

  for (let i = 0; i < maxLines; i++) {
    const lineNum = i + 1;
    const baseLine = baseLines[i];
    const modLine = modLines[i];

    if (baseLine !== undefined && modLine !== undefined) {
      if (baseLine !== modLine) {
        result.push({
          lineNumber: lineNum,
          changeType: "Modified",
          oldValue: baseLine.trim(),
          newValue: modLine.trim()
        });
      }
    } else if (modLine !== undefined) {
      result.push({
        lineNumber: lineNum,
        changeType: "Added",
        oldValue: "",
        newValue: modLine.trim()
      });
    } else if (baseLine !== undefined) {
      result.push({
        lineNumber: lineNum,
        changeType: "Deleted",
        oldValue: baseLine.trim(),
        newValue: ""
      });
    }
  }
  return result;
}

// 4. API Endpoints
app.get("/api/tasks", (req, res) => {
  res.json(codeTasks);
});

app.post("/api/tasks", (req, res) => {
  const { taskId, baseBranch, featureBranch, description, developer, repositoryUrl } = req.body;
  if (!taskId) return res.status(400).json({ error: "Task ID is required" });

  const targetId = taskId.toUpperCase();
  const exists = codeTasks.some(t => {
    if (!t.taskId) return false;
    const clean = String(t.taskId).toUpperCase();
    return clean === targetId || clean === `TASK-${targetId}` || `TASK-${clean}` === targetId;
  });

  if (exists) {
    return res.status(400).json({ error: `Task with ID '${taskId}' already exists.` });
  }

  const newTask = {
    taskId,
    baseBranch: baseBranch || "main",
    featureBranch: featureBranch || "feature-" + taskId.toLowerCase(),
    description: description || "Custom developer workspace snapshot.",
    developer: developer || "Lead Developer",
    createdDate: new Date().toISOString(),
    repositoryUrl: repositoryUrl || "https://github.com/enterprise/source.git",
    commitId: "m" + Math.random().toString(16).substring(2, 9)
  };

  codeTasks.push(newTask);
  res.status(201).json(newTask);
});

app.delete("/api/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const targetId = taskId.toUpperCase();

  // Robust check: match TASK-1001 or 1001 or any case casing format
  const matchTask = (id: string | undefined | null) => {
    if (!id) return false;
    const clean = String(id).toUpperCase();
    return clean === targetId || clean === `TASK-${targetId}` || `TASK-${clean}` === targetId;
  };

  const exists = codeTasks.some(t => matchTask(t.taskId));
  if (!exists) {
    return res.status(404).json({ error: "Task not found" });
  }

  // Remove task, files, conflicts, recommendations
  codeTasks = codeTasks.filter(t => !matchTask(t.taskId));
  taskFiles = taskFiles.filter(f => !matchTask(f.taskId));
  taskConflicts = taskConflicts.filter(c => !matchTask(c.taskId));
  aiRecommendations = aiRecommendations.filter(r => !matchTask(r.taskId));

  res.json({
    success: true,
    message: `Task ${taskId} and all its associated file snapshots, conflicts, and recommendations have been permanently deleted.`
  });
});

app.put("/api/files/:fileId", (req, res) => {
  const { fileId } = req.params;
  const { featureContent } = req.body;
  const file = taskFiles.find(f => f.id === fileId);
  if (!file) return res.status(404).json({ error: "File snapshot not found" });

  file.featureContent = featureContent || "";
  
  // If the file was a conflict but the markers are now removed, mark it resolved
  if (file.isConflict) {
    if (!file.featureContent.includes("<<<<<<< HEAD") && !file.featureContent.includes("=======") && !file.featureContent.includes(">>>>>>>")) {
      file.isResolved = true;
    }
  }

  // Also update comparison metrics in task conflicts list
  const conflict = taskConflicts.find(c => c.fileId === fileId);
  if (conflict) {
    conflict.resolution = file.featureContent;
  }

  // Sync to physical server workspace so "Enterprise Deliverables" includes only this
  const fullPath = path.join(getEnterpriseDir(), file.path);
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.featureContent, "utf-8");
  } catch (err) {
    console.error("Failed to sync updated file to disk:", err);
  }

  res.json({
    success: true,
    message: `Successfully updated code snapshot for file ${file.fileName}.`,
    file
  });
});

app.get("/api/tasks/:taskId/files", (req, res) => {
  const { taskId } = req.params;
  const targetId = taskId.toUpperCase();
  const matchTask = (id: string | undefined | null) => {
    if (!id) return false;
    const clean = String(id).toUpperCase();
    return clean === targetId || clean === `TASK-${targetId}` || `TASK-${clean}` === targetId;
  };
  const filtered = taskFiles.filter(f => matchTask(f.taskId));
  res.json(filtered);
});

app.delete("/api/files/:fileId", (req, res) => {
  const { fileId } = req.params;
  const file = taskFiles.find(f => f.id === fileId);
  if (!file) return res.status(404).json({ error: "File snapshot not found" });

  taskFiles = taskFiles.filter(f => f.id !== fileId);
  taskConflicts = taskConflicts.filter(c => c.fileId !== fileId);

  // Sync deletion with physical server workspace
  const fullPath = path.join(getEnterpriseDir(), file.path);
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    console.error("Failed to delete physical file:", err);
  }

  res.json({
    success: true,
    message: `Successfully deleted file snapshot ${file.fileName}.`
  });
});

app.get("/api/files/:fileId/content", (req, res) => {
  const file = taskFiles.find(f => f.id === req.params.fileId);
  if (!file) return res.status(404).json({ error: "File not found" });
  res.json(file);
});

app.post("/api/tasks/:taskId/files", (req, res) => {
  const { fileName, path: filePath, extension, baseContent, featureContent } = req.body;
  const taskId = req.params.taskId;

  if (!fileName) return res.status(400).json({ error: "File Name is required" });

  const fileId = "file_" + Date.now();
  const startsWithConflict = (featureContent || "").includes("<<<<<<< HEAD");

  const newFile = {
    id: fileId,
    taskId,
    fileName,
    path: filePath || fileName,
    extension: extension || fileName.split('.').pop() || "cs",
    baseContent: baseContent || "",
    featureContent: featureContent || "",
    resolvedContent: "",
    isConflict: startsWithConflict,
    isResolved: false
  };

  taskFiles.push(newFile);

  // Sync upload with physical server workspace
  const fullPath = path.join(getEnterpriseDir(), filePath || fileName);
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, featureContent || baseContent || "", "utf-8");
  } catch (err) {
    console.error("Failed to write physical uploaded file to disk:", err);
  }

  if (startsWithConflict) {
    taskConflicts.push({
      id: "c_" + Date.now(),
      taskId,
      fileId,
      conflictText: featureContent,
      resolution: "",
      auditTrail: [
        `System: Merge conflicts detected on file upload inside ${fileName}`
      ]
    });
  }

  res.status(201).json(newFile);
});

// Compare Diffs dynamically
app.post("/api/compare", (req, res) => {
  const { baseContent, featureContent, fileName } = req.body;
  try {
    const diffs = detectDifferences(baseContent || "", featureContent || "");
    res.json({
      fileName: fileName || "file.cs",
      additions: diffs.filter(d => d.changeType === "Added").length,
      deletions: diffs.filter(d => d.changeType === "Deleted").length,
      modifications: diffs.filter(d => d.changeType === "Modified").length,
      details: diffs
    });
  } catch (ex: any) {
    res.status(500).json({ error: ex.message });
  }
});

// Save Conflict Resolution
app.post("/api/tasks/merge-resolution", (req, res) => {
  const { fileId, resolution, actionName } = req.body;
  const file = taskFiles.find(f => f.id === fileId);
  if (!file) return res.status(404).json({ error: "File record not found" });

  file.resolvedContent = resolution;
  file.isResolved = true;

  const conflict = taskConflicts.find(c => c.fileId === fileId);
  if (conflict) {
    conflict.resolution = resolution;
    conflict.auditTrail.push(`Developer resolved conflict dynamically using command: "Accept ${actionName || 'Manual'}" at ${new Date().toLocaleString()}`);
  }

  res.json({ message: "Merge conflict successfully resolved!", file });
});

// Get metrics state
app.get("/api/dashboard/metrics", (req, res) => {
  const totalTasks = codeTasks.length;
  const totalConflicts = taskFiles.filter(f => f.isConflict).length;
  const resolvedConflicts = taskFiles.filter(f => f.isConflict && f.isResolved).length;
  const filesChanged = taskFiles.length;

  res.json({
    totalTasks,
    totalConflicts,
    resolvedConflicts,
    filesChanged
  });
});

// Retrieve Recommendations
app.get("/api/tasks/:taskId/recommendations", (req, res) => {
  const filtered = aiRecommendations.filter(r => r.taskId === req.params.taskId);
  res.json(filtered);
});

// Run Live Gemini AI Recommendations Review
app.post("/api/tasks/:taskId/ai-suggestions", async (req, res) => {
  const { taskId } = req.params;
  const files = taskFiles.filter(f => f.taskId === taskId);
  
  if (files.length === 0) {
    return res.json([
      {
        id: "r_f1",
        taskId,
        recommendationText: "Add code files for this task. Once added, Gemini will execute code optimizations dynamically.",
        category: "Code Quality"
      }
    ]);
  }

  const primaryFile = files[0];
  const fileContextText = `File: ${primaryFile.fileName}\nContext Base:\n${primaryFile.baseContent}\nContext Feature:\n${primaryFile.featureContent}`;

  if (ai && geminiApiKey) {
    try {
      const systemInstruction = `You are an expert enterprise C# software architect performing change inspections on a developers task workspace. You must output a JSON array of suggestions. Each item must have of the following properties exactly:
- category: must be one of: "Code Quality", "Repeated Changes", "Conflict Prediction", "Refactoring"
- recommendationText: a clear, insightful human-like recommendation (e.g. flagging complex submethods, identifying connection leaks, noticing duplicate class patterns, suggesting shared services, or predicting merge friction).
Always return a raw valid JSON array. Do not include markdown tags, do not wrap in backticks, just output pristine JSON.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Inspect the file differences and code context:\n${fileContextText}\n\nProvide relevant architectural or lines-density reviews.`,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json"
        }
      });

      const parsedText = (response.text || "").trim();
      let structuredJson = JSON.parse(parsedText);
      
      const responseList = Array.isArray(structuredJson) ? structuredJson : [structuredJson];
      const items = responseList.map((item: any, idx: number) => ({
        id: "ai_" + Date.now() + "_" + idx,
        taskId,
        category: item.category || "Code Quality",
        recommendationText: item.recommendationText || "Consider cleaning duplicate methods."
      }));

      // Merge and save state
      aiRecommendations = aiRecommendations.filter(r => r.taskId !== taskId).concat(items);
      return res.json(items);
    } catch (ex: any) {
      console.error("Gemini runtime fail: ", ex);
    }
  }

  // Fallback realistic reviews in case API key is missing or calls are throttled
  const fallback = [
    {
      id: "ai_fb1",
      taskId,
      category: "Code Quality",
      recommendationText: `Method lengths inside ${primaryFile.fileName} are tidy, but inline error-handling can be structured into filter blocks.`
    },
    {
      id: "ai_fb2",
      taskId,
      category: "Refactoring",
      recommendationText: "Method validation logic is duplicated across endpoints. Extract helper validations into Shared/ValidatorUtils."
    },
    {
      id: "ai_fb3",
      taskId,
      category: "Conflict Prediction",
      recommendationText: `${primaryFile.fileName} is frequently modified in parallel branches. Coordinate with Marcus Chen before commits.`
    }
  ];
  
  aiRecommendations = aiRecommendations.filter(r => r.taskId !== taskId).concat(fallback);
  res.json(fallback);
});

// Serve list of written deliverables from physical filesystem
app.get("/api/deliverables/files", (req, res) => {
  const rootDir = getEnterpriseDir();
  const filesList: any[] = [];

  function walk(dir: string, relPath = "") {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const relative = path.join(relPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath, relative);
      } else {
        const content = fs.readFileSync(fullPath, "utf-8");
        const matchingFile = taskFiles.find(tf => {
          const p1 = String(tf.path || "").replace(/\\/g, "/").toLowerCase();
          const p2 = String(relative || "").replace(/\\/g, "/").toLowerCase();
          const f1 = String(tf.fileName || "").toLowerCase();
          const f2 = String(item || "").toLowerCase();
          return p1 === p2 || f1 === f2;
        });
        const baseContent = matchingFile ? matchingFile.baseContent : content;
        filesList.push({
          name: item,
          path: relative,
          content,
          baseContent
        });
      }
    }
  }

  walk(rootDir);
  res.json(filesList);
});

app.delete("/api/deliverables/files", (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: "File path parameter 'path' is required" });

  // Convert all backslashes to forward slashes first to standardise, then normalize
  const standardRelPath = relPath.replace(/\\/g, "/");
  const cleanPath = path.normalize(standardRelPath).replace(/^(\.\.(\/|\\|$))+/, "");
  
  // Resolve path segments independently to bypass platform path separator differences
  const segments = cleanPath.split(/[/\\]/).filter(Boolean);
  let fullPath = path.join(getEnterpriseDir(), ...segments);

  if (!fs.existsSync(fullPath)) {
    // try standard join as fallback
    const altPath = path.join(getEnterpriseDir(), relPath.replace(/\\/g, path.sep));
    if (fs.existsSync(altPath)) {
      fullPath = altPath;
    }
  }

  // Deep recursive search fallback if still not found
  if (!fs.existsSync(fullPath)) {
    const rootDir = getEnterpriseDir();
    const findFile = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const sub = path.join(dir, item);
        const rel = path.relative(rootDir, sub).replace(/\\/g, "/").toLowerCase();
        if (rel === standardRelPath.toLowerCase() || item.toLowerCase() === path.basename(standardRelPath).toLowerCase()) {
          return sub;
        }
        if (fs.statSync(sub).isDirectory()) {
          const found = findFile(sub);
          if (found) return found;
        }
      }
      return null;
    };
    const foundPath = findFile(rootDir);
    if (foundPath) {
      fullPath = foundPath;
    }
  }

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: `File not found on disk at: ${cleanPath}` });
  }

  try {
    fs.unlinkSync(fullPath);

    // Also sync and remove from taskFiles in memory to prevent saved files from appearing/reconstituting
    const fileNameLower = path.basename(fullPath).toLowerCase();
    taskFiles = taskFiles.filter(tf => {
      const tfPath = String(tf.path || "").replace(/\\/g, "/").toLowerCase();
      const tfName = String(tf.fileName || "").toLowerCase();
      const targetPath = standardRelPath.toLowerCase();
      return tfPath !== targetPath && tfName !== fileNameLower;
    });

    res.json({ success: true, message: `Successfully deleted deliverable ${relPath} and cleared task workspace references.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dynamic CSV Report download route
app.get("/api/reports/download-csv", (req, res) => {
  const taskId = req.query.taskId as string || "TASK-1001";
  const task = codeTasks.find(t => t.taskId === taskId) || codeTasks[0];
  const files = taskFiles.filter(f => f.taskId === task.taskId);

  let csvContent = `CODE WORKSPACE CHANGE MANAGEMENT REPORT\r\n`;
  csvContent += `Generated At,${new Date().toLocaleString()}\r\n`;
  csvContent += `Task ID,${task.taskId}\r\n`;
  csvContent += `Developer,${task.developer}\r\n`;
  csvContent += `Base Branch,${task.baseBranch}\r\n`;
  csvContent += `Feature Branch,${task.featureBranch}\r\n`;
  csvContent += `Repository,${task.repositoryUrl}\r\n\r\n`;
  
  csvContent += `FILE COMPARISON SUMMARY\r\n`;
  csvContent += `File,Path,Extension,Conflict,Resolved\r\n`;

  files.forEach(f => {
    csvContent += `"${f.fileName}","${f.path}","${f.extension}",${f.isConflict ? "YES" : "NO"},${f.isResolved ? "YES" : "NO"}\r\n`;
  });

  csvContent += `\r\nDETAILED CODE CHANGES (ADDED & DELETED LINES)\r\n`;
  csvContent += `File Name,Line Number,Change Type,Code Line\r\n`;

  let totalChanges = 0;
  files.forEach(f => {
    const diffs = detectDifferences(f.baseContent || "", f.featureContent || "");
    diffs.forEach(d => {
      if (d.changeType === "Added") {
        totalChanges++;
        const escapedNew = String(d.newValue || "").replace(/"/g, '""');
        csvContent += `"${f.fileName}",${d.lineNumber},"Added","${escapedNew}"\r\n`;
      } else if (d.changeType === "Deleted") {
        totalChanges++;
        const escapedOld = String(d.oldValue || "").replace(/"/g, '""');
        csvContent += `"${f.fileName}",${d.lineNumber},"Deleted","${escapedOld}"\r\n`;
      } else if (d.changeType === "Modified") {
        totalChanges += 2;
        const escapedOld = String(d.oldValue || "").replace(/"/g, '""');
        const escapedNew = String(d.newValue || "").replace(/"/g, '""');
        csvContent += `"${f.fileName}",${d.lineNumber},"Deleted","${escapedOld}"\r\n`;
        csvContent += `"${f.fileName}",${d.lineNumber},"Added","${escapedNew}"\r\n`;
      }
    });
  });

  if (totalChanges === 0) {
    csvContent += `"-",-,"None","No added or deleted lines detected (Files are identical)."\r\n`;
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=CodeChangeReport_${task.taskId}.csv`);
  res.send(csvContent);
});

// 5. Mount Vite integration and launch Server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(3000, "0.0.0.0", () => {
    console.log("Full-stack Code Change workspace booted successfully up on port 3000");
  });
}

// Run standalone web server locally or in standard Docker/Cloud Run containered environments
if (!process.env.VERCEL) {
  startServer();
}

export default app;
