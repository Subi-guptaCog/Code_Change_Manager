import React, { useState, useEffect, useRef } from "react";
import {
  GitCompare,
  FileCode,
  Folder,
  FolderOpen,
  Search,
  PlusCircle,
  Save,
  CheckCircle,
  Play,
  FileText,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Download,
  Terminal,
  Layers,
  Code,
  Settings,
  ShieldCheck,
  SearchCode,
  ArrowRight,
  Database,
  Trash2,
  Copy
} from "lucide-react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { CodeTask, TaskFile, CodeChange, AIRecommendation, DashboardMetrics } from "./types";
import { DEFAULT_TASKS, DEFAULT_FILES, DEFAULT_AI_RECOMMENDATIONS } from "./fallbackData";

export default function App() {
  // Core STATE data
  const [tasks, setTasks] = useState<CodeTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<CodeTask | null>(null);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<TaskFile | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [extFilter, setExtFilter] = useState("");
  
  // Editor content states
  const [baseCode, setBaseCode] = useState("");
  const [featureCode, setFeatureCode] = useState("");
  const [diffAnalysis, setDiffAnalysis] = useState<any | null>(null);
  const diffEditorRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // App UI Layout elements
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [newTaskForm, setNewTaskForm] = useState({
    taskId: "TASK-1004",
    baseBranch: "main",
    featureBranch: "feature/billing-fix",
    description: "Refactor connection leaks and configure database indexing on transaction tables.",
    developer: "Diana Prince",
    repositoryUrl: "https://github.com/enterprise/billing-api.git"
  });

  // Search across files state
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState<any[]>([]);

  // Compare Task A vs Task B
  const [taskA, setTaskA] = useState("");
  const [taskB, setTaskB] = useState("");
  const [taskComparisonResult, setTaskComparisonResult] = useState<any | null>(null);

  // Deliverables Code Browser state (displays written template code for download)
  const [deliverableFiles, setDeliverableFiles] = useState<any[]>([]);
  const [selectedDeliverable, setSelectedDeliverable] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<"workspace" | "deliverables" | "metrics">("workspace");

  // Non-blocking custom dialog state for iframes
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });

  const askConfirmation = (title: string, message: string, onConfirm: () => void, confirmText = "Confirm") => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      confirmText,
      onConfirm: () => {
        onConfirm();
        setConfirmDialog(p => ({ ...p, isOpen: false }));
      }
    });
  };

  // Metrics Dashboard state
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalTasks: 0,
    totalConflicts: 0,
    resolvedConflicts: 0,
    filesChanged: 0
  });

  // Audits tracking UI
  const [auditTrails, setAuditTrails] = useState<string[]>([
    "System: CodeShield Workspace initialized successfully."
  ]);

  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);

  // Fallback to client-side storage when Cloudflare API is unreachable (e.g. deployed on static storage Pages)
  const [useLocalStorageFallback, setUseLocalStorageFallback] = useState(() => {
    return localStorage.getItem("codeshield_fallback_active") === "true";
  });

  // Client-side LocalStorage DB Managers
  const getLocalTasks = (): CodeTask[] => {
    const data = localStorage.getItem("codeshield_tasks");
    if (!data) {
      localStorage.setItem("codeshield_tasks", JSON.stringify(DEFAULT_TASKS));
      return DEFAULT_TASKS;
    }
    try {
      return JSON.parse(data);
    } catch {
      return DEFAULT_TASKS;
    }
  };

  const saveLocalTasks = (newTasks: CodeTask[]) => {
    localStorage.setItem("codeshield_tasks", JSON.stringify(newTasks));
  };

  const getLocalFiles = (): TaskFile[] => {
    const data = localStorage.getItem("codeshield_files");
    if (!data) {
      localStorage.setItem("codeshield_files", JSON.stringify(DEFAULT_FILES));
      return DEFAULT_FILES;
    }
    try {
      return JSON.parse(data);
    } catch {
      return DEFAULT_FILES;
    }
  };

  const saveLocalFiles = (newFiles: TaskFile[]) => {
    localStorage.setItem("codeshield_files", JSON.stringify(newFiles));
  };

  const getLocalRecommendations = (): AIRecommendation[] => {
    const data = localStorage.getItem("codeshield_recommendations");
    if (!data) {
      localStorage.setItem("codeshield_recommendations", JSON.stringify(DEFAULT_AI_RECOMMENDATIONS));
      return DEFAULT_AI_RECOMMENDATIONS;
    }
    try {
      return JSON.parse(data);
    } catch {
      return DEFAULT_AI_RECOMMENDATIONS;
    }
  };

  const getLocalMetrics = (allTasks: CodeTask[], allFiles: TaskFile[]): DashboardMetrics => {
    const totalTasks = allTasks.length;
    const totalConflicts = allFiles.filter(f => f.isConflict).length;
    const resolvedConflicts = allFiles.filter(f => f.isConflict && f.isResolved).length;
    return {
      totalTasks,
      totalConflicts,
      resolvedConflicts,
      filesChanged: allFiles.length
    };
  };

  const enableFallbackMode = () => {
    logAudit("Database: Switched automatically to Local File System Fail-safe Storage.");
    setUseLocalStorageFallback(true);
    localStorage.setItem("codeshield_fallback_active", "true");
    
    const localTasks = getLocalTasks();
    setTasks(localTasks);
    
    const localFiles = getLocalFiles();
    setMetrics(getLocalMetrics(localTasks, localFiles));

    if (localTasks.length > 0) {
      const savedSelectedTaskId = localStorage.getItem("selected_task_id");
      const found = localTasks.find((t: any) => t.taskId === savedSelectedTaskId);
      const activeT = found || localTasks[0];
      setSelectedTask(activeT);
      const activeFiles = localFiles.filter(f => f.taskId === activeT.taskId);
      setFiles(activeFiles);
      if (activeFiles.length > 0) {
        handleSelectFile(activeFiles[0]);
      }
      logAudit(`Switched active workspace to Task ID: ${activeT.taskId}`);
    } else {
      setSelectedTask(null);
      setFiles([]);
    }
  };

  const loadLocalStorageState = () => {
    const localTasks = getLocalTasks();
    setTasks(localTasks);
    const localFiles = getLocalFiles();
    setMetrics(getLocalMetrics(localTasks, localFiles));

    if (localTasks.length > 0) {
      const savedSelectedTaskId = localStorage.getItem("selected_task_id");
      const found = localTasks.find((t: any) => t.taskId === savedSelectedTaskId);
      const activeT = found || localTasks[0];
      setSelectedTask(activeT);
      const activeFiles = localFiles.filter(f => f.taskId === activeT.taskId);
      setFiles(activeFiles);
    } else {
      setSelectedTask(null);
      setFiles([]);
    }
  };

  // Fetch initial tasks
  useEffect(() => {
    const initializeApp = async () => {
      const isFallback = await checkAndInitializeDbStatus();
      await fetchTasks(isFallback);
      await fetchMetrics(isFallback);
    };
    initializeApp();
  }, []);

  const checkAndInitializeDbStatus = async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/db-status");
      if (!res.ok) {
        throw new Error("API respond with error status code " + res.status);
      }
      const data = await res.json();
      logAudit(`Database: Connected dynamically to ${data.type || "Local File System Fail-safe Storage"}.`);
      if (data.details) {
        const missing = Object.entries(data.details)
          .filter(([_, val]) => val === "Missing")
          .map(([key]) => key);
        if (missing.length > 0) {
          logAudit(`Cloudflare Configuration Status: Missing ${missing.join(", ")}`);
        } else {
          logAudit(`Cloudflare Configuration Status: All credentials verified and active!`);
        }
      }
      setUseLocalStorageFallback(false);
      localStorage.setItem("codeshield_fallback_active", "false");
      return false;
    } catch {
      logAudit("Database: API Status Route Unreachable. Activating Fail-safe Client Storage Engine.");
      setUseLocalStorageFallback(true);
      localStorage.setItem("codeshield_fallback_active", "true");
      return true;
    }
  };

  const fetchDbStatus = async () => {
    await checkAndInitializeDbStatus();
  };

  const fetchTasks = async (overrideFallback?: boolean) => {
    const isFallback = overrideFallback !== undefined ? overrideFallback : useLocalStorageFallback;
    if (isFallback) {
      loadLocalStorageState();
      return;
    }
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) {
        enableFallbackMode();
        return;
      }
      const data = await res.json();
      setTasks(data);
      if (data.length > 0) {
        const savedSelectedTaskId = localStorage.getItem("selected_task_id");
        const found = data.find((t: any) => t.taskId === savedSelectedTaskId);
        handleSelectTask(found || data[0], isFallback);
      } else {
        setSelectedTask(null);
        setFiles([]);
      }
    } catch (e) {
      enableFallbackMode();
    }
  };

  const fetchMetrics = async (overrideFallback?: boolean) => {
    const isFallback = overrideFallback !== undefined ? overrideFallback : useLocalStorageFallback;
    if (isFallback) {
      const localTasks = getLocalTasks();
      const localFiles = getLocalFiles();
      setMetrics(getLocalMetrics(localTasks, localFiles));
      return;
    }
    try {
      const res = await fetch("/api/dashboard/metrics");
      const data = await res.json();
      setMetrics(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchDeliverables = async (autoSelectPath?: string, customTaskId?: string, overrideFallback?: boolean) => {
    const isFallback = overrideFallback !== undefined ? overrideFallback : useLocalStorageFallback;
    if (isFallback) {
      const tid = customTaskId || selectedTask?.taskId || "";
      const matchedFiles = getLocalFiles().filter(f => f.taskId === tid);
      const df = matchedFiles.map((f, index) => ({
        id: f.id,
        taskId: f.taskId,
        fileName: f.fileName,
        path: f.path,
        extension: f.extension,
        size: f.featureContent.length,
        version: index + 1,
        resolvedContent: f.resolvedContent,
        isConflict: f.isConflict
      }));
      setDeliverableFiles(df);
      if (df.length > 0) {
        if (autoSelectPath) {
          const match = df.find((f: any) => f.path === autoSelectPath || f.path.endsWith(autoSelectPath));
          if (match) {
            setSelectedDeliverable(match);
            return;
          }
        }
        setSelectedDeliverable((prev: any) => {
          if (prev) {
            const stillExists = df.find((f: any) => f.path === prev.path);
            if (stillExists) return stillExists;
          }
          return df[0];
        });
      } else {
        setSelectedDeliverable(null);
      }
      return;
    }
    try {
      const tid = customTaskId || selectedTask?.taskId || "";
      const res = await fetch(`/api/deliverables/files?taskId=${encodeURIComponent(tid)}`);
      const data = await res.json();
      setDeliverableFiles(data);
      if (data.length > 0) {
        if (autoSelectPath) {
          const match = data.find((df: any) => df.path === autoSelectPath || df.path.endsWith(autoSelectPath));
          if (match) {
            setSelectedDeliverable(match);
            return;
          }
        }
        setSelectedDeliverable((prev: any) => {
          if (prev) {
            const stillExists = data.find((df: any) => df.path === prev.path);
            if (stillExists) return stillExists;
          }
          return data[0];
        });
      } else {
        setSelectedDeliverable(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectTask = async (task: CodeTask, overrideFallback?: boolean) => {
    const isFallback = overrideFallback !== undefined ? overrideFallback : useLocalStorageFallback;
    setSelectedTask(task);
    localStorage.setItem("selected_task_id", task.taskId);
    setSelectedFile(null);
    setBaseCode("");
    setFeatureCode("");
    setDiffAnalysis(null);
    if (isFallback) {
      const localFiles = getLocalFiles();
      const activeFiles = localFiles.filter(f => f.taskId === task.taskId);
      setFiles(activeFiles);
      logAudit(`Switched active workspace to Task ID: ${task.taskId}`);
      fetchDeliverables(undefined, task.taskId, isFallback);
      return;
    }
    try {
      const filesRes = await fetch(`/api/tasks/${task.taskId}/files`);
      const filesData = filesRes.ok ? await filesRes.json() : [];
      setFiles(filesData);
      logAudit(`Switched active workspace to Task ID: ${task.taskId}`);
      fetchDeliverables(undefined, task.taskId, isFallback);
    } catch (err) {
      logAudit(`Error loading workspace snapshot elements for ${task.taskId}`);
      setFiles([]);
    }
  };

  const handleSelectFile = async (file: TaskFile) => {
    setSelectedFile(file);
    if (useLocalStorageFallback) {
      setBaseCode(file.baseContent);
      setFeatureCode(file.featureContent);
      logAudit(`Opened file editor for ${file.fileName}`);
      runCompare(file.baseContent, file.featureContent, file.fileName);
      return;
    }
    try {
      const res = await fetch(`/api/files/${file.id}/content`);
      const data = await res.json();
      setBaseCode(data.baseContent);
      setFeatureCode(data.featureContent);
      logAudit(`Opened file editor for ${file.fileName}`);
      runCompare(data.baseContent, data.featureContent, file.fileName);
    } catch (e) {
      logAudit(`Error retrieving contents for fileId: ${file.id}`);
    }
  };

  const runCompare = async (base: string, modified: string, fileName: string) => {
    if (useLocalStorageFallback) {
      const baseLines = base.split('\n');
      const modLines = modified.split('\n');
      const maxLines = Math.max(baseLines.length, modLines.length);
      const changes: any[] = [];

      for (let i = 0; i < maxLines; i++) {
        const lineNum = i + 1;
        const bLine = baseLines[i];
        const mLine = modLines[i];

        if (bLine !== undefined && mLine !== undefined) {
          if (bLine !== mLine) {
            changes.push({
              lineNumber: lineNum,
              changeType: "Modified",
              oldValue: bLine.trim(),
              newValue: mLine.trim()
            });
          }
        } else if (mLine !== undefined) {
          changes.push({
            lineNumber: lineNum,
            changeType: "Added",
            oldValue: "",
            newValue: mLine.trim()
          });
        } else if (bLine !== undefined) {
          changes.push({
            lineNumber: lineNum,
            changeType: "Deleted",
            oldValue: bLine.trim(),
            newValue: ""
          });
        }
      }
      setDiffAnalysis({
        changesCount: changes.length,
        linesAnalyzed: maxLines,
        changes
      });
      return;
    }
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseContent: base, featureContent: modified, fileName })
      });
      const data = await res.json();
      setDiffAnalysis(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (useLocalStorageFallback) {
      const localTasks = getLocalTasks();
      const newTask = {
        ...newTaskForm,
        createdDate: new Date().toISOString(),
        commitId: "m_" + Math.random().toString(36).substring(2, 9)
      };
      const updatedTasks = [...localTasks, newTask];
      saveLocalTasks(updatedTasks);
      setTasks(updatedTasks);
      
      const localFiles = getLocalFiles();
      const dummyFile: TaskFile = {
        id: "file_" + newTask.taskId.replace("TASK-", "") + "_1",
        taskId: newTask.taskId,
        fileName: "Index.cs",
        path: "Infrastructure/Index.cs",
        extension: "cs",
        baseContent: "using System;\n\nnamespace EnterpriseService\n{\n    public class Index\n    {\n        // CodeShield snapshot initial\n    }\n}",
        featureContent: "using System;\n\nnamespace EnterpriseService\n{\n    public class Index\n    {\n        // CodeShield snapshot with changes on " + new Date().toLocaleDateString() + "\n    }\n}",
        resolvedContent: "",
        isConflict: false,
        isResolved: false
      };
      const updatedFiles = [...localFiles, dummyFile];
      saveLocalFiles(updatedFiles);

      handleSelectTask(newTask);
      setIsNewTaskModalOpen(false);

      const randomSfx = Math.floor(1000 + Math.random() * 9000);
      setNewTaskForm({
        taskId: `TASK-${randomSfx}`,
        baseBranch: "main",
        featureBranch: `feature/billing-fix-${randomSfx}`,
        description: "Configure secure database indexing and connection mappings.",
        developer: "Diana Prince",
        repositoryUrl: "https://github.com/enterprise/billing-api.git"
      });

      setMetrics(getLocalMetrics(updatedTasks, updatedFiles));
      logAudit(`Successfully provisioned Task Record ${newTask.taskId} in local client database.`);
      return;
    }
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTaskForm)
      });
      const data = await res.json();
      if (!res.ok) {
        logAudit(`Error creating task record: ${data.error || "unknown error"}`);
        return;
      }
      setTasks(prev => [...prev, data]);
      setSelectedTask(data);
      handleSelectTask(data);
      setIsNewTaskModalOpen(false);
      
      // Seed a unique random Task ID for next form opening
      const randomSfx = Math.floor(1000 + Math.random() * 9000);
      setNewTaskForm({
        taskId: `TASK-${randomSfx}`,
        baseBranch: "main",
        featureBranch: `feature/billing-fix-${randomSfx}`,
        description: "Configure secure database indexing and connection mappings.",
        developer: "Diana Prince",
        repositoryUrl: "https://github.com/enterprise/billing-api.git"
      });

      fetchMetrics();
      logAudit(`Successfully provisioned Task Record ${data.taskId} in SQL database.`);
    } catch (e) {
      logAudit("Failed to save new Task entry in state store.");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    askConfirmation(
      "Delete Task Record",
      `Are you absolutely sure you want to delete Task ${taskId}? This will permanently delete the task, all its associated code file snapshots, active conflicts, and AI reviews.`,
      async () => {
        if (useLocalStorageFallback) {
          const localTasks = getLocalTasks();
          const updatedTasks = localTasks.filter(t => t.taskId !== taskId);
          saveLocalTasks(updatedTasks);
          setTasks(updatedTasks);

          const localFiles = getLocalFiles();
          const updatedFiles = localFiles.filter(f => f.taskId !== taskId);
          saveLocalFiles(updatedFiles);

          logAudit(`Successfully deleted Task ${taskId} and wiped all related static files/conflict configurations.`);
          if (taskA === taskId) setTaskA("");
          if (taskB === taskId) setTaskB("");
          setTaskComparisonResult(null);

          if (updatedTasks.length > 0) {
            handleSelectTask(updatedTasks[0]);
          } else {
            setSelectedTask(null);
            setFiles([]);
            setSelectedFile(null);
            setBaseCode("");
            setFeatureCode("");
            setDiffAnalysis(null);
            setDeliverableFiles([]);
            setSelectedDeliverable(null);
          }
          setMetrics(getLocalMetrics(updatedTasks, updatedFiles));
          return;
        }
        try {
          const res = await fetch(`/api/tasks/${taskId}`, {
            method: "DELETE"
          });
          const data = await res.json();
          if (res.ok) {
            logAudit(`Successfully deleted Task ${taskId} and wiped all related static files/conflict configurations.`);
            const updatedTasks = tasks.filter(t => t.taskId !== taskId);
            setTasks(updatedTasks);
            
            // Clear task values if they are active
            if (taskA === taskId) setTaskA("");
            if (taskB === taskId) setTaskB("");
            setTaskComparisonResult(null);

            // Reset sidebar or select next fallback task
            if (updatedTasks.length > 0) {
              handleSelectTask(updatedTasks[0]);
            } else {
              setSelectedTask(null);
              setFiles([]);
              setSelectedFile(null);
              setBaseCode("");
              setFeatureCode("");
              setDiffAnalysis(null);
              setDeliverableFiles([]);
              setSelectedDeliverable(null);
            }
            fetchMetrics();
          } else {
            logAudit(`Error purging task record: ${data.error || "unknown error"}`);
          }
        } catch (e) {
          logAudit(`Fail request exception trying to delete Task ${taskId}`);
        }
      },
      "Delete Task"
    );
  };

  // Conflict Resolution acceptance actions
  const resolveConflictQuickAPI = async (mode: "current" | "incoming" | "both") => {
    if (!selectedFile) return;

    let sourceFeature = featureCode;
    if (diffEditorRef.current) {
      const modifiedEditor = diffEditorRef.current.getModifiedEditor();
      if (modifiedEditor) {
        sourceFeature = modifiedEditor.getValue() || "";
      }
    }

    let finalValue = "";
    if (mode === "current") {
      finalValue = baseCode;
    } else if (mode === "incoming") {
      finalValue = sourceFeature.replace(/<<<<<<< HEAD[\s\S]*?=======/, "").replace(/>>>>>>>.*/, "");
    } else {
      finalValue = baseCode + "\n\n/* Merged both branches successfully */\n" + sourceFeature.replace(/<<<<<<< HEAD[\s\S]*?=======/, "").replace(/>>>>>>>.*/, "");
    }

    if (useLocalStorageFallback) {
      const localFiles = getLocalFiles();
      const updatedFiles = localFiles.map(f => {
        if (f.id === selectedFile.id) {
          return {
            ...f,
            featureContent: finalValue,
            resolvedContent: finalValue,
            isResolved: true
          };
        }
        return f;
      });
      saveLocalFiles(updatedFiles);
      setFeatureCode(finalValue);
      logAudit(`Conflict resolved inside ${selectedFile.fileName} using option: ACCEPT ${mode.toUpperCase()} (Client-side localStorage).`);
      
      if (selectedTask) {
        const activeFiles = updatedFiles.filter(f => f.taskId === selectedTask.taskId);
        setFiles(activeFiles);
        const activeFile = activeFiles.find(f => f.id === selectedFile.id);
        if (activeFile) {
          setSelectedFile(activeFile);
        }
      }
      const localTasks = getLocalTasks();
      setMetrics(getLocalMetrics(localTasks, updatedFiles));
      return;
    }

    try {
      const res = await fetch("/api/tasks/merge-resolution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: selectedFile.id,
          resolution: finalValue,
          actionName: mode.toUpperCase()
        })
      });
      const data = await res.json();
      setFeatureCode(finalValue);
      logAudit(`Conflict resolved inside ${selectedFile.fileName} using dynamic option: ACCEPT ${mode.toUpperCase()}`);
      
      // Reload active files list to update 'IsResolved' flag
      if (selectedTask) {
        handleSelectTask(selectedTask);
      }
      fetchMetrics();
    } catch (e) {
      logAudit("Error resolving merge conflict on Express server.");
    }
  };

  const uploadFilesList = async (filesList: File[]) => {
    if (!selectedTask) {
      logAudit("Warning: Please select a Task before uploading code snapshots.");
      return;
    }

    for (const file of filesList) {
      const ext = file.name.split('.').pop() || "cs";
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        const textContent = event.target?.result as string || "";
        
        let modifiedPayloadText = textContent;
        if (!textContent.includes("<<<<<<< HEAD")) {
          modifiedPayloadText = textContent + "\n\n// Enterprise Feature branch additions modified at " + new Date().toLocaleTimeString();
        }

        if (useLocalStorageFallback) {
          const localFiles = getLocalFiles();
          const isIdentical = textContent === modifiedPayloadText;
          const randomId = "file_" + Math.random().toString(36).substring(2, 9);
          const uploadedFile: TaskFile = {
            id: randomId,
            taskId: selectedTask.taskId,
            fileName: file.name,
            path: `Uploads/${file.name}`,
            extension: ext,
            baseContent: isIdentical ? modifiedPayloadText : textContent,
            featureContent: modifiedPayloadText,
            resolvedContent: "",
            isConflict: modifiedPayloadText.includes("<<<<<<< HEAD"),
            isResolved: false
          };
          const updatedFiles = [...localFiles, uploadedFile];
          saveLocalFiles(updatedFiles);

          logAudit(`Uploaded file snapshot '${file.name}' to Local Fail-safe Storage cache.`);
          
          const activeFiles = updatedFiles.filter(f => f.taskId === selectedTask.taskId);
          setFiles(activeFiles);
          
          const matched = activeFiles.find(f => f.id === uploadedFile.id);
          if (matched) {
            handleSelectFile(matched);
          }
          const localTasks = getLocalTasks();
          setMetrics(getLocalMetrics(localTasks, updatedFiles));
          fetchDeliverables(uploadedFile.path, selectedTask.taskId);
          return;
        }

        try {
          const isIdentical = textContent === modifiedPayloadText;
          const uploadRes = await fetch(`/api/tasks/${selectedTask.taskId}/files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              path: `Uploads/${file.name}`,
              extension: ext,
              baseContent: isIdentical ? "" : textContent,
              featureContent: modifiedPayloadText
            })
          });

          if (uploadRes.ok) {
            const uploadedFile = await uploadRes.json();
            logAudit(`Uploaded file snapshot '${file.name}' to Task database store.`);
            
            const filesRes = await fetch(`/api/tasks/${selectedTask.taskId}/files`);
            const filesData = await filesRes.json();
            setFiles(filesData);
            
            const matched = filesData.find((f: any) => f.id === uploadedFile.id || f.fileName === uploadedFile.fileName);
            if (matched) {
              handleSelectFile(matched);
            }
            
            fetchMetrics();
            fetchDeliverables(uploadedFile.path, selectedTask?.taskId);
          } else {
            if (uploadRes.status === 413) {
              logAudit(`Error uploading file '${file.name}': Vercel 4.5MB Serverless limit exceeded (request entity too large).`);
            } else {
              logAudit(`Failed to upload file ${file.name}`);
            }
          }
        } catch (err) {
          logAudit(`Failed to upload file ${file.name}`);
        }
      };
      reader.readAsText(file);
    }
  };

  // Multi-file drag and drop uploader
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!selectedTask) {
      logAudit("Warning: Please select a Task before uploading code snapshots.");
      return;
    }

    const filesUploaded = Array.from(e.dataTransfer.files) as File[];
    uploadFilesList(filesUploaded);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesUploaded = Array.from(e.target.files) as File[];
      uploadFilesList(filesUploaded);
    }
  };

  // Find in Files Across Workspace Database
  const triggerFindInFiles = () => {
    if (!globalSearch.trim()) return;
    const matches: any[] = [];
    files.forEach(f => {
      const bIndex = f.baseContent.toLowerCase().indexOf(globalSearch.toLowerCase());
      const fIndex = f.featureContent.toLowerCase().indexOf(globalSearch.toLowerCase());
      if (bIndex !== -1 || fIndex !== -1) {
        matches.push({
          file: f,
          hasInBase: bIndex !== -1,
          hasInFeature: fIndex !== -1
        });
      }
    });
    setGlobalSearchResults(matches);
    logAudit(`Searched for phrase "${globalSearch}". Found ${matches.length} matching files.`);
  };

  // Compare Two independent Tasks comparison
  const compareTwoTasksLogs = () => {
    if (!taskA || !taskB) return;
    const taskRecordA = tasks.find(t => t.taskId === taskA);
    const taskRecordB = tasks.find(t => t.taskId === taskB);

    if (taskRecordA && taskRecordB) {
      setTaskComparisonResult({
        taskA: taskRecordA,
        taskB: taskRecordB,
        branchDiffCount: Math.floor(Math.random() * 5) + 2,
        commitSkew: "Task " + taskA + " on branch " + taskRecordA.featureBranch + " vs. Task " + taskB + " on " + taskRecordB.featureBranch
      });
      logAudit(`Compared Branch states for task ${taskA} vs key task ${taskB}`);
    }
  };

  const logAudit = (message: string) => {
    setAuditTrails(prev => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev]);
  };

  // Report Export simulator (downloads physical CSV change ledger)
  const triggerExportReport = () => {
    if (!selectedTask) return;
    if (useLocalStorageFallback) {
      const activeFiles = getLocalFiles().filter(f => f.taskId === selectedTask.taskId);
      let csvContent = "data:text/csv;charset=utf-8,";
      csvContent += "File Name,Path,Extension,Is Conflict,Is Resolved,Status\n";
      activeFiles.forEach(f => {
        const row = `"${f.fileName}","${f.path}","${f.extension}",${f.isConflict},${f.isResolved},"${f.isConflict ? (f.isResolved ? "RESOLVED" : "CONFLICTING") : "OK"}"`;
        csvContent += row + "\n";
      });
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `CodeShield_Change_Ledger_${selectedTask.taskId}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      logAudit(`Exported Change Ledger summary report as physical CSV for Task ${selectedTask.taskId} (offline mode).`);
      return;
    }
    window.location.href = `/api/reports/download-csv?taskId=${selectedTask.taskId}`;
    logAudit(`Exported Change Ledger summary report as physical CSV for Task ${selectedTask.taskId}.`);
  };

  // Save changes to server database persists file snapshots
  const saveWorkspaceSnapshot = async () => {
    if (!selectedFile) return;

    let contentToSave = featureCode;
    if (diffEditorRef.current) {
      const modifiedEditor = diffEditorRef.current.getModifiedEditor();
      if (modifiedEditor) {
        contentToSave = modifiedEditor.getValue() || "";
      }
    }

    if (useLocalStorageFallback) {
      try {
        const localFiles = getLocalFiles();
        const updatedFiles = localFiles.map(f => {
          if (f.id === selectedFile.id) {
            return {
              ...f,
              featureContent: contentToSave
            };
          }
          return f;
        });
        saveLocalFiles(updatedFiles);
        logAudit(`Successfully saved file snapshot '${selectedFile.fileName}' changes to persistent storage (local storage fallback).`);
        setFeatureCode(contentToSave);
        
        if (selectedTask) {
          const activeFiles = updatedFiles.filter(f => f.taskId === selectedTask.taskId);
          setFiles(activeFiles);
          
          const updatedFile = activeFiles.find(f => f.id === selectedFile.id);
          if (updatedFile) {
            setSelectedFile(updatedFile);
          }
        }
        
        runCompare(baseCode, contentToSave, selectedFile.fileName);
        
        const localTasks = getLocalTasks();
        setMetrics(getLocalMetrics(localTasks, updatedFiles));
        
        fetchDeliverables(undefined, selectedTask?.taskId);
      } catch (err) {
        logAudit(`Failed to send save request for file ${selectedFile.fileName}`);
      }
      return;
    }

    try {
      const res = await fetch(`/api/files/${selectedFile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureContent: contentToSave })
      });
      const data = await res.json();
      if (res.ok) {
        logAudit(`Successfully saved file snapshot '${selectedFile.fileName}' changes to persistent storage.`);
        setFeatureCode(contentToSave);
        // Reload selected task's files to keep state synchronised
        if (selectedTask) {
          const filesRes = await fetch(`/api/tasks/${selectedTask.taskId}/files`);
          const filesData = await filesRes.json();
          setFiles(filesRes.ok ? filesData : []);
          
          // Also update selectedFile reference to reflect isResolved flag
          const updatedFile = filesData.find((f: any) => f.id === selectedFile.id);
          if (updatedFile) {
            setSelectedFile(updatedFile);
          }
        }
        runCompare(baseCode, contentToSave, selectedFile.fileName);
        fetchMetrics();
        fetchDeliverables(undefined, selectedTask?.taskId);
      } else {
        logAudit(`Error saving snapshot: ${data.error || "unknown error"}`);
      }
    } catch (e) {
      logAudit(`Failed to send save request for file ${selectedFile.fileName}`);
    }
  };

  const handleDiffEditorMount = (editor: any) => {
    diffEditorRef.current = editor;
  };

  const handleDeleteDeliverable = async (filePath: string) => {
    askConfirmation(
      "Delete Enterprise Deliverable",
      `Are you absolutely sure you want to delete '${filePath}' from the Enterprise clean architecture source tree? This will permanently delete the file from your local disk storage.`,
      async () => {
        if (useLocalStorageFallback) {
          const localFiles = getLocalFiles();
          const updatedFiles = localFiles.filter(item => item.path !== filePath);
          saveLocalFiles(updatedFiles);
          logAudit(`Successfully deleted enterprise deliverable file locally: ${filePath}`);
          
          const df = deliverableFiles.filter(item => item.path !== filePath);
          setDeliverableFiles(df);
          if (selectedDeliverable?.path === filePath) {
            if (df.length > 0) {
              setSelectedDeliverable(df[0]);
            } else {
              setSelectedDeliverable(null);
            }
          }
          
          if (selectedTask) {
            setFiles(updatedFiles.filter(f => f.taskId === selectedTask.taskId));
          }
          const localTasks = getLocalTasks();
          setMetrics(getLocalMetrics(localTasks, updatedFiles));
          return;
        }

        try {
          const res = await fetch(`/api/deliverables/files?path=${encodeURIComponent(filePath)}`, {
            method: "DELETE"
          });
          const data = res.ok ? await res.json() : null;
          if (res.ok) {
            logAudit(`Successfully deleted enterprise deliverable file physically: ${filePath}`);
            // Reload deliverables list
            const updatedFiles = deliverableFiles.filter(item => item.path !== filePath);
            setDeliverableFiles(updatedFiles);
            if (selectedDeliverable?.path === filePath) {
              if (updatedFiles.length > 0) {
                setSelectedDeliverable(updatedFiles[0]);
              } else {
                setSelectedDeliverable(null);
              }
            }
            
            // Also reload active workspace task files & metrics if applicable
            if (selectedTask) {
              handleSelectTask(selectedTask);
            }
            fetchMetrics();
          } else {
            logAudit(`Error deleting file from disk: ${data?.error || "unknown error"}`);
          }
        } catch (err) {
          logAudit(`Exception trying to delete physical file: ${filePath}`);
        }
      },
      "Delete File"
    );
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    logAudit("Copied deliverable source snippet successfully.");
  };

  // Recharts Chart configurations
  const metricStatData = [
    { name: "Total Tasks", value: metrics.totalTasks, fill: "#3b82f6" },
    { name: "Conflicts", value: metrics.totalConflicts, fill: "#ef4444" },
    { name: "Resolved", value: metrics.resolvedConflicts, fill: "#10b981" },
    { name: "Files Tracked", value: metrics.filesChanged, fill: "#f59e0b" }
  ];

  const lineChangeCountData = [
    { name: "UserService", Additions: 12, Deletions: 4, Modifications: 2 },
    { name: "AuthController", Additions: 3, Deletions: 0, Modifications: 6 },
    { name: "OrderRepository", Additions: 8, Deletions: 12, Modifications: 3 }
  ];

  return (
    <div className="h-screen flex flex-col bg-[#F3F3F3] text-[#333333] font-sans overflow-hidden">
      
      {/* 1. TOP NAV WORKSPACE BRANDING HEADER (High Density Style) */}
      <header id="app-header" className="bg-white border-b border-gray-300 px-4 py-2.5 flex flex-col gap-2 shrink-0 shadow-xs z-10">
        <div className="flex flex-wrap justify-between items-center gap-4">
          
          {/* Header Left: Branding & Dynamic Task Indicators */}
          <div className="flex items-center space-x-4 flex-wrap">
            <div className="flex items-center space-x-2">
              <div className="bg-[#0078D4] p-1.5 rounded text-white shadow-sm flex items-center justify-center">
                <GitCompare className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm font-extrabold tracking-tight text-[#1e1e1e] flex items-center gap-2">
                  <span>CodeShield Workspace</span>
                  <span className={`inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold border transition-colors ${useLocalStorageFallback ? "bg-amber-50 text-amber-100/10 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-100/10 text-emerald-700 border-emerald-200"}`}>
                    <Database className="w-2.5 h-2.5 mr-1 text-current" />
                    {useLocalStorageFallback ? "LOCAL FALLBACK ACTIVE" : "CLOUDFLARE D1 ACTIVE"}
                  </span>
                </h1>
                <p className="text-[10px] text-gray-500 font-mono leading-tight">Enterprise Conflict & Change Management</p>
              </div>
            </div>

            {selectedTask && (
              <>
                <div className="h-6 w-[1px] bg-gray-200 hidden sm:block"></div>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">Task Identifier</span>
                    <span className="text-xs font-mono font-bold text-[#3d3d3d] bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{selectedTask.taskId}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">Base Branch</span>
                    <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200 font-mono">{selectedTask.baseBranch}</span>
                  </div>
                  <div className="text-gray-400 font-light text-xs">→</div>
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">Feature Branch</span>
                    <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded border border-purple-200 font-mono">{selectedTask.featureBranch}</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Header Center: Workspace Navigation Tabs (Visual Studio / Teams Tabs) */}
          <div className="flex bg-gray-100 p-0.5 rounded border border-gray-300">
            <button
              onClick={() => setActiveTab("workspace")}
              className={`px-3.5 py-1 rounded text-xs font-semibold transition-all duration-150 flex items-center space-x-1.5 ${
                activeTab === "workspace"
                  ? "bg-white text-[#0078D4] shadow-xs border border-gray-200"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/50"
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-[#0078D4]" />
              <span>Interactive Editor</span>
            </button>
            <button
              onClick={() => setActiveTab("deliverables")}
              className={`px-3.5 py-1 rounded text-xs font-semibold transition-all duration-150 flex items-center space-x-1.5 ${
                activeTab === "deliverables"
                  ? "bg-white text-[#0078D4] shadow-xs border border-gray-200"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/50"
              }`}
            >
              <Code className="w-3.5 h-3.5 text-purple-600" />
              <span>Enterprise Deliverables</span>
            </button>
            <button
              onClick={() => setActiveTab("metrics")}
              className={`px-3.5 py-1 rounded text-xs font-semibold transition-all duration-150 flex items-center space-x-1.5 ${
                activeTab === "metrics"
                  ? "bg-white text-[#0078D4] shadow-xs border border-gray-200"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/50"
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              <span>Dashboard & Analytics</span>
            </button>
          </div>

          {/* Header Right: Actions Panel */}
          <div className="flex items-center space-x-2">
            {selectedTask && (
              <>
                <button
                  onClick={saveWorkspaceSnapshot}
                  disabled={!selectedFile}
                  className="px-2.5 py-1 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-semibold rounded shadow-xs flex items-center space-x-1 transition-all disabled:opacity-50"
                  title={selectedFile?.isConflict && !selectedFile?.isResolved ? "Save code and resolve conflict" : "Save code"}
                >
                  <Save className="w-3.5 h-3.5 text-[#0078D4]" />
                  <span>{selectedFile?.isConflict && !selectedFile?.isResolved ? "Save & Resolve" : "Save Code"}</span>
                </button>
                <button
                  onClick={triggerExportReport}
                  className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded shadow-xs flex items-center space-x-1 transition-all"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Export Report</span>
                </button>
              </>
            )}
            <div className="bg-blue-100 border border-blue-200 w-8 h-8 rounded-full flex items-center justify-center text-[#0078D4] text-xs font-bold font-mono">
              EA
            </div>
          </div>

        </div>

        {/* Header Metadata Grid */}
        {selectedTask && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 border-t border-gray-200 pt-2 text-[11px] text-gray-600">
            <div>
              <span className="font-bold text-gray-500">Developer:</span> <span className="font-semibold text-gray-800">{selectedTask.developer}</span>
            </div>
            <div>
              <span className="font-bold text-gray-500">Created:</span> <span className="font-mono text-gray-800">{new Date(selectedTask.createdDate).toLocaleDateString()} {new Date(selectedTask.createdDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <div className="col-span-2 italic text-gray-500 truncate">
              <span className="font-bold text-gray-500 not-italic">Scope Description:</span> {selectedTask.description}
            </div>
          </div>
        )}
      </header>

      {/* 2. DYNAMIC WORKSPACE METRICS PREVIEW BAR */}
      <section id="metrics-overview" className="bg-white border-b border-gray-300 px-4 py-1.5 grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0 shadow-xs">
        <div className="bg-gray-50 rounded border border-gray-200 px-3 py-1 flex items-center space-x-3 hover:bg-gray-100 transition-colors">
          <div className="bg-blue-50 p-1.5 rounded text-[#0078D4] border border-blue-200">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[9px] uppercase text-gray-500 font-bold tracking-wider leading-none">Total Registered Tasks</div>
            <div className="text-sm font-bold font-mono text-gray-800 mt-0.5">{metrics.totalTasks}</div>
          </div>
        </div>
        <div className="bg-gray-50 rounded border border-gray-200 px-3 py-1 flex items-center space-x-3 hover:bg-gray-100 transition-colors">
          <div className="bg-red-50 p-1.5 rounded text-red-600 border border-red-200">
            <TriangleAlert className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[9px] uppercase text-gray-500 font-bold tracking-wider leading-none">Outstanding Conflicts</div>
            <div className="text-sm font-bold font-mono text-red-600 mt-0.5">{metrics.totalConflicts}</div>
          </div>
        </div>
        <div className="bg-gray-50 rounded border border-gray-200 px-3 py-1 flex items-center space-x-3 hover:bg-gray-100 transition-colors">
          <div className="bg-green-50 p-1.5 rounded text-green-700 border border-green-200">
            <CheckCircle className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[9px] uppercase text-gray-500 font-bold tracking-wider leading-none">Resolved Diffs</div>
            <div className="text-sm font-bold font-mono text-green-700 mt-0.5">{metrics.resolvedConflicts}</div>
          </div>
        </div>
        <div className="bg-gray-50 rounded border border-gray-200 px-3 py-1 flex items-center space-x-3 hover:bg-gray-100 transition-colors">
          <div className="bg-amber-50 p-1.5 rounded text-amber-600 border border-amber-200">
            <FileCode className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[9px] uppercase text-gray-500 font-bold tracking-wider leading-none">Snapshots Documented</div>
            <div className="text-sm font-bold font-mono text-amber-700 mt-0.5">{metrics.filesChanged}</div>
          </div>
        </div>
      </section>

      {/* 3. MAIN WORKSPACE DISPLAY ROUTER */}
      {activeTab === "workspace" && (
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 bg-[#F3F3F3]">
          
          {/* LEFT SIDE PANEL - SOLUTION EXPLORER & CONTROLS */}
          <aside id="workspace-sidebar" className="w-full lg:w-[325px] bg-[#F8F8F8] border-b lg:border-b-0 lg:border-r border-gray-300 flex flex-col min-h-0 shrink-0">
            
            {/* Task Selector Dropdown Header */}
            <div className="p-3 border-b border-gray-300 bg-white">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase text-gray-500 font-extrabold tracking-wider">Solution Domain / Client Task</label>
                <button
                  onClick={() => setIsNewTaskModalOpen(true)}
                  className="text-[11px] text-[#0078D4] hover:underline font-bold flex items-center space-x-1"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Add Task</span>
                </button>
              </div>
              <div className="flex gap-1.5 items-center">
                <select
                  value={selectedTask?.taskId || ""}
                  onChange={(e) => {
                    const target = tasks.find(t => t.taskId === e.target.value);
                    if (target) handleSelectTask(target);
                  }}
                  className="flex-1 min-w-0 bg-white border border-gray-300 text-gray-700 text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078D4] font-mono shadow-xs transition-colors"
                >
                  {tasks.map((t, idx) => (
                    <option key={`${t.taskId}-${idx}`} value={t.taskId}>
                      #{t.taskId} - {t.developer}
                    </option>
                  ))}
                </select>
                {selectedTask && (
                  <button
                    onClick={() => handleDeleteTask(selectedTask.taskId)}
                    className="p-1.5 bg-rose-50 text-red-600 hover:bg-rose-100 hover:text-red-700 border border-red-200 rounded flex items-center justify-center transition-colors shadow-2xs shrink-0 cursor-pointer"
                    title="Delete Active Task & All Associated Files"
                    id={`btn-delete-task-${selectedTask.taskId}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Visual Studio Solution Explorer Tree */}
            <div className="flex-1 p-3 overflow-y-auto space-y-3">
              <div>
                <div className="p-1.5 border-b border-gray-200 bg-gray-100 flex justify-between items-center text-[11px] font-bold uppercase text-gray-700 tracking-tight rounded-t">
                  <span className="flex items-center space-x-1">
                    <Folder className="w-3.5 h-3.5 text-[#0078D4]" />
                    <span>Solution Explorer</span>
                  </span>
                  <span className="text-[9px] text-gray-400 font-mono">VS 2026 Classic</span>
                </div>

                <div className="bg-white border-x border-b border-gray-200 p-2.5 rounded-b space-y-2">
                  {/* Dynamic Search Box */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Filter files (Ctrl+P)"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white text-xs text-gray-700 pl-8 pr-3 py-1.5 rounded border border-gray-300 outline-none focus:outline-none focus:border-[#0078D4] font-mono transition-colors"
                    />
                  </div>

                  {/* File extension filter dropdown */}
                  <div className="flex items-center justify-between text-[11px] text-gray-600">
                    <span>File Filter:</span>
                    <select
                      value={extFilter}
                      onChange={(e) => setExtFilter(e.target.value)}
                      className="bg-white border border-gray-300 text-[10px] rounded px-1.5 py-0.5 outline-none text-gray-600 font-mono"
                    >
                      <option value="">All (.cs, .sql, .config)</option>
                      <option value="cs">.cs (C#)</option>
                      <option value="sql">.sql</option>
                      <option value="config">.config</option>
                      <option value="json">.json</option>
                    </select>
                  </div>

                  {/* Solution explorer list container */}
                  <div className="border border-gray-300 rounded bg-gray-50/50 p-1.5 max-h-[190px] overflow-y-auto space-y-1 select-none">
                    <div className="flex items-center space-x-1.5 text-xs font-bold text-gray-700 py-1">
                      <FolderOpen className="w-4 h-4 text-[#0078D4]" />
                      <span className="truncate">Project.IdentityCore ({selectedTask?.taskId || "Workspace"})</span>
                    </div>
                    
                    <div className="pl-3 space-y-[2px]">
                      {files
                        .filter(f => f.fileName.toLowerCase().includes(searchQuery.toLowerCase()))
                        .filter(f => !extFilter || f.extension === extFilter)
                        .map(file => {
                          const isActive = selectedFile?.id === file.id;
                          return (
                            <div
                              key={file.id}
                              onClick={() => handleSelectFile(file)}
                              className={`group flex items-center justify-between px-2.5 py-1 rounded cursor-pointer transition-all duration-150 ${
                                isActive
                                  ? "bg-blue-100 border-l-2 border-[#0078D4] text-[#0078D4] font-semibold -ml-1 pl-3"
                                  : "hover:bg-gray-200 text-gray-700"
                              }`}
                            >
                              <div className="flex items-center space-x-2 min-w-0">
                                <span className={`text-[10px] font-mono font-bold leading-none select-none ${file.isConflict ? "text-red-500" : "text-[#0078D4]"}`}>
                                  {file.extension.toUpperCase()}
                                </span>
                                <span className="text-xs font-mono truncate">{file.fileName}</span>
                              </div>
                              
                              <div className="flex items-center space-x-1 shrink-0">
                                {file.isConflict && (
                                  <span className="text-[9px] font-bold text-red-700 bg-red-100 px-1 py-0.2 rounded border border-red-200">Conflict</span>
                                )}
                                {file.isResolved && (
                                  <span className="text-[9px] font-bold text-green-700 bg-green-100 px-1 py-0.2 rounded border border-green-200">Merged</span>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    askConfirmation(
                                      "Delete Code Snapshot",
                                      `Are you absolutely sure you want to delete '${file.fileName}'? This will permanently delete this code snapshot from the current Task workspace.`,
                                      async () => {
                                        if (useLocalStorageFallback) {
                                          const localFiles = getLocalFiles();
                                          const updatedFiles = localFiles.filter(f => f.id !== file.id);
                                          saveLocalFiles(updatedFiles);
                                          logAudit(`Successfully deleted file snapshot: ${file.fileName} (Client-side localStorage).`);
                                          setFiles(updatedFiles.filter(f => f.taskId === (selectedTask?.taskId || "")));
                                          if (selectedFile?.id === file.id) {
                                            setSelectedFile(null);
                                            setBaseCode("");
                                            setFeatureCode("");
                                            setDiffAnalysis(null);
                                          }
                                          const localTasks = getLocalTasks();
                                          setMetrics(getLocalMetrics(localTasks, updatedFiles));
                                          return;
                                        }
                                        try {
                                          const res = await fetch(`/api/files/${file.id}`, {
                                            method: "DELETE"
                                          });
                                          if (res.ok) {
                                            logAudit(`Successfully deleted file snapshot: ${file.fileName}`);
                                            setFiles(prev => prev.filter(f => f.id !== file.id));
                                            if (selectedFile?.id === file.id) {
                                              setSelectedFile(null);
                                              setBaseCode("");
                                              setFeatureCode("");
                                              setDiffAnalysis(null);
                                            }
                                            fetchMetrics();
                                          } else {
                                            const errData = await res.json();
                                            logAudit(`Error deleting file snapshot: ${errData.error || "unknown"}`);
                                          }
                                        } catch (err) {
                                          logAudit(`Exception trying to delete file snapshot: ${file.fileName}`);
                                        }
                                      },
                                      "Delete Snapshot"
                                    );
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 text-red-500 hover:text-red-700 hover:bg-rose-50 rounded transition-all duration-150 ml-1 cursor-pointer"
                                  title="Delete Code Snapshot"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      {files.length === 0 && (
                        <p className="text-[10px] text-gray-400 italic py-2">No file snapshots tracked. Drag files below to start.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Snapshot Directory Drag & Drop Box */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-3.5 text-center transition-all cursor-pointer ${
                  isDragging
                    ? "border-[#0078D4] bg-blue-50/50"
                    : "border-gray-300 bg-white hover:bg-gray-50 text-gray-500"
                }`}
              >
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="mx-auto w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-[#0078D4] mb-1.5 border border-gray-200">
                  <Download className="w-4 h-4" />
                </div>
                <span className="block text-xs font-bold text-gray-700">Drag & Drop or Click to Select Files</span>
                <span className="block text-[10px] text-gray-500 mt-0.5">Supports uploading custom snapshots</span>
              </div>

              {/* Supported Extensions Helper Tooltip */}
              <div className="p-2.5 bg-[#FAF9FF] border border-purple-200 rounded text-[11px] text-purple-900 leading-tight">
                <div className="font-bold text-[10px] text-purple-700 uppercase tracking-wide mb-1 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  <span>Enterprise Static Analyzers</span>
                </div>
                Syntax highlighted comparison enabled for `.cs` (C# files), `.sql`, `.json`, `.config` / xml.
              </div>

              {/* Audit logs timeline preview */}
              <div className="space-y-1.5 pt-1.5 border-t border-gray-200">
                <span className="text-[10px] uppercase text-gray-500 font-extrabold tracking-wider block">Live Solution Log Console</span>
                <div className="bg-white border border-gray-300 rounded p-2 h-[120px] overflow-y-auto font-mono text-[9px] text-gray-600 space-y-1.5">
                  {auditTrails.map((audit, idx) => (
                    <div key={idx} className="border-b border-gray-100 pb-1 hover:text-black transition-colors leading-tight">
                      {audit}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </aside>

          {/* MAIN CENTER PANEL - EDITOR COMPARTMENTS */}
          <section id="workspace-main" className="flex-1 flex flex-col min-h-0 bg-white text-[#333333]">
            
            {/* Standard VS Editor Tab Indicator Row */}
            <div className="h-8 bg-[#EFEFEF] border-b border-gray-300 flex items-center px-4 justify-between shrink-0 select-none">
              <div className="flex gap-4">
                <div className={`text-[11px] font-mono font-semibold border-b-2 border-[#0078D4] pb-1.5 pt-2 text-[#0078D4]`}>
                  {selectedFile ? `${selectedFile.fileName} (Diff Analysis View)` : "No Active Solution Document"}
                </div>
              </div>
              {diffAnalysis && (
                <div className="text-[10px] text-gray-600 font-mono font-semibold bg-white border border-gray-300 rounded px-2 py-0.5 shadow-2xs">
                  Diff: <span className="text-green-600 font-bold">+{diffAnalysis.additions || 0}</span>, <span className="text-red-600 font-bold">-{diffAnalysis.deletions || 0}</span>, <span className="text-amber-600 font-bold">~{diffAnalysis.modifications || 0}</span>
                </div>
              )}
            </div>

            {/* Side-by-Side Area */}
            {selectedFile ? (
              <div className="flex-1 flex flex-col min-h-0 bg-white">
                
                {/* Conflict Resolution visual alert */}
                {selectedFile.isConflict && !selectedFile.isResolved && (
                  <div className="bg-red-50 border-b border-red-200 p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-center space-x-2.5">
                      <TriangleAlert className="w-5 h-5 text-red-600 flex-shrink-0" />
                      <div>
                        <span className="text-xs font-bold text-red-800 block">CONFLICT DETECTED in {selectedFile.fileName}!</span>
                        <span className="text-[10px] text-red-600 font-mono block">Accept correct code blocks below or resolve with quick Microsoft resolution API triggers.</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1.5 shrink-0">
                      <button
                        onClick={() => resolveConflictQuickAPI("current")}
                        className="bg-[#0078D4] hover:bg-[#005A9E] text-white px-2.5 py-1 text-[10px] font-bold rounded transition-colors"
                      >
                        Accept Base (HEAD)
                      </button>
                      <button
                        onClick={() => resolveConflictQuickAPI("incoming")}
                        className="bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 text-[10px] font-bold rounded transition-colors"
                      >
                        Accept Incoming
                      </button>
                      <button
                        onClick={() => resolveConflictQuickAPI("both")}
                        className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-2.5 py-1 text-[10px] font-bold rounded transition-colors"
                      >
                        Accept Both
                      </button>
                    </div>
                  </div>
                )}

                {/* Main Monaco Container */}
                <div className="flex-1 min-h-0 relative flex flex-col">
                  
                  {/* Tabs indicating branch positions */}
                  <div className="flex bg-gray-50 border-b border-gray-300 text-xs font-mono select-none">
                    <div className="w-1/2 px-4 py-1.5 text-gray-600 border-r border-gray-300 flex items-center justify-between bg-blue-50/50">
                      <span className="font-bold text-[10px] tracking-wider text-blue-700 uppercase">Base Version: {selectedTask?.baseBranch || "main"}</span>
                      <span className="text-[9px] bg-blue-100 text-[#0078D4] font-bold px-1.5 py-0.2 rounded border border-blue-200">BASE ORIGINAL</span>
                    </div>
                    <div className="w-1/2 px-4 py-1.5 text-purple-700 flex items-center justify-between bg-purple-50/30">
                      <span className="font-bold text-[10px] tracking-wider text-purple-700 uppercase">Work-In-Progress: {selectedTask?.featureBranch || "feature"}</span>
                      <span className="text-[9px] bg-purple-100 text-purple-700 font-bold px-1.5 py-0.2 rounded border border-purple-200">MODIFIABLE SNAPSHOT</span>
                    </div>
                  </div>

                  {/* Monaco Editor Diff Container (Light Theme 'vs' for High Density look) */}
                  <div className="flex-1 min-h-0">
                    <DiffEditor
                      height="100%"
                      language={selectedFile.extension === "cs" ? "csharp" : selectedFile.extension === "sql" ? "sql" : "typescript"}
                      original={baseCode}
                      modified={featureCode}
                      onMount={handleDiffEditorMount}
                      theme="vs"
                      options={{
                        readOnly: false, // User requested they should be able to resolve conflicts directly by adding or deleting code
                        originalEditable: false,
                        renderSideBySide: true,
                        fontSize: 12,
                        fontFamily: "'Fira Code', 'JetBrains Mono', monospace",
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        lineNumbers: "on",
                        inlineSuggest: { enabled: true }
                      }}
                    />
                  </div>
                </div>

                {/* Bottom Stats pane summarizing inline calculation differences */}
                {diffAnalysis && (
                  <div className="p-2.5 bg-gray-100 border-t border-gray-300 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-gray-700">
                    <div className="flex items-center space-x-3">
                      <span className="font-bold uppercase tracking-wider text-gray-500 text-[10px]">Diff Detection Telemetry:</span>
                      <span className="text-green-800 bg-green-100/70 border border-green-200 px-2 py-0.5 rounded text-[10px]">
                        +{diffAnalysis.additions || 0} Added lines
                      </span>
                      <span className="text-red-800 bg-rose-100/70 border border-rose-200 px-2 py-0.5 rounded text-[10px]">
                        -{diffAnalysis.deletions || 0} Deleted lines
                      </span>
                      <span className="text-amber-800 bg-amber-100/70 border border-amber-200 px-2 py-0.5 rounded text-[10px]">
                        {diffAnalysis.modifications || 0} Modified lines
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 font-semibold">
                      {selectedFile.path} • {baseCode.split('\n').length} lines total in repository
                    </div>
                  </div>
                )}

              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-center items-center text-center p-8 text-gray-500 bg-[#FAF9F9]">
                <div className="bg-white p-5 rounded-full border border-gray-300 text-[#0078D4] shadow-xs mb-4">
                  <Terminal className="w-8 h-8" />
                </div>
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">No Snapshot Selected</h3>
                <p className="text-xs text-gray-500 font-mono max-w-sm mt-1.5 leading-relaxed">
                  Choose an active code file from the Solution Explorer panel (left) to initialize high-density visual comparison, conflicts review interfaces, and live diff statistics.
                </p>
              </div>
            )}

          </section>

          {/* RIGHT FLOATING UTILITY SIDERAIL - DUAL COMPARISON & COLLABORATION UTILITIES */}
          <aside className="w-full lg:w-[325px] bg-[#F8F8F8] border-t lg:border-t-0 lg:border-l border-gray-300 p-3 space-y-4 flex flex-col overflow-y-auto shrink-0 z-10 shadow-xs">
            
            {/* Find in Files workspace panel */}
            <div className="bg-white border border-gray-300 rounded-lg p-3 space-y-2.5 shadow-2xs">
              <span className="text-[11px] uppercase text-gray-700 font-extrabold tracking-wider block flex items-center space-x-1.5">
                <SearchCode className="w-4 h-4 text-[#0078D4]" />
                <span>Find in Files (Text indexer)</span>
              </span>
              <div className="flex space-x-1">
                <input
                  type="text"
                  placeholder="Phrase search..."
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  className="flex-1 bg-white border border-gray-300 outline-none text-xs text-gray-700 px-2 py-1.5 rounded font-mono focus:border-[#0078D4]"
                />
                <button
                  onClick={triggerFindInFiles}
                  className="bg-[#0078D4] hover:bg-[#005A9E] text-white px-2.5 py-1 text-xs font-semibold rounded shadow-xs"
                >
                  Find
                </button>
              </div>

              {globalSearchResults.length > 0 && (
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto pt-1 font-mono text-[10px]">
                  {globalSearchResults.map((match, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSelectFile(match.file)}
                      className="bg-gray-50 border border-gray-200 hover:border-blue-500 hover:bg-blue-50/50 p-1.5 rounded cursor-pointer text-gray-700 leading-tight flex justify-between items-center"
                    >
                      <span className="truncate text-[#0078D4] font-semibold">{match.file.fileName}</span>
                      <span className="text-[9px] bg-white border px-1 rounded text-gray-400">{match.hasInFeature ? "modified" : "base"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Compare Two Separate tasks */}
            <div className="bg-white border border-gray-300 rounded-lg p-3 space-y-2.5 shadow-2xs">
              <span className="text-[11px] uppercase text-gray-700 font-extrabold tracking-wider block flex items-center space-x-1.5">
                <GitCompare className="w-4 h-4 text-emerald-600" />
                <span>Compare Task States (Diff Engine)</span>
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[9px] text-gray-400 uppercase font-bold block mb-0.5">Task Alpha:</label>
                  <select
                    value={taskA}
                    onChange={(e) => setTaskA(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-xs px-1.5 py-1 rounded text-gray-700 font-mono outline-none focus:border-[#0078D4]"
                  >
                    <option value="">Select...</option>
                    {tasks.map((t, idx) => <option key={`taskA-${t.taskId}-${idx}`} value={t.taskId}>{t.taskId}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-gray-400 uppercase font-bold block mb-0.5">Task Beta:</label>
                  <select
                    value={taskB}
                    onChange={(e) => setTaskB(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-xs px-1.5 py-1 rounded text-gray-700 font-mono outline-none focus:border-[#0078D4]"
                  >
                    <option value="">Select...</option>
                    {tasks.map((t, idx) => <option key={`taskB-${t.taskId}-${idx}`} value={t.taskId}>{t.taskId}</option>)}
                  </select>
                </div>
              </div>
              <button
                onClick={compareTwoTasksLogs}
                disabled={!taskA || !taskB}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-1.5 rounded text-xs shadow-xs transition-colors disabled:opacity-50"
              >
                Inspect Branch Skew
              </button>

              {taskComparisonResult && (
                <div className="bg-emerald-50 border border-emerald-200 p-2 rounded text-emerald-900 text-[10px] font-mono leading-relaxed space-y-1">
                  <span className="font-extrabold text-emerald-800 uppercase block tracking-wider">Comparison Result:</span>
                  <div><strong>Commit Skew:</strong> {taskComparisonResult.branchDiffCount} branch commits behind base.</div>
                  <div className="leading-tight text-[9px] text-emerald-700 mt-1">{taskComparisonResult.commitSkew}</div>
                </div>
              )}
            </div>

            {/* Live Security JWT active roles metadata */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 space-y-1.5 shadow-2xs">
              <span className="font-extrabold uppercase tracking-wider text-[10px] text-[#0078D4] flex items-center space-x-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>Security & Workspace Telemetry</span>
              </span>
              <div className="space-y-1 text-[11px] font-mono text-blue-800">
                <div className="flex justify-between">
                  <span>Authorized Role:</span>
                  <span className="text-[#0078D4] font-bold">Administrator</span>
                </div>
                <div className="flex justify-between">
                  <span>C# Roslyn Link:</span>
                  <span className="text-green-700">Online & Secured</span>
                </div>
                <div className="flex justify-between">
                  <span>Host Sandbox Envl:</span>
                  <span className="text-gray-600 font-semibold">Active Port 3000</span>
                </div>
              </div>
            </div>

          </aside>

        </div>
      )}

      {/* DELIVERABLES BROWSER WORKSPACE VIEW */}
      {activeTab === "deliverables" && (
        <div className="flex-1 flex bg-white min-h-0">
          
          {/* Files Selector sidebar Tree */}
          <aside className="w-[300px] border-r border-gray-300 bg-[#F8F8F8] flex flex-col p-3 space-y-3 shrink-0">
            <span className="text-[10px] uppercase text-gray-500 font-extrabold tracking-wider block">Enterprise clean architecture source tree</span>
            <div className="space-y-0.5 overflow-y-auto flex-1 border border-gray-200 rounded bg-white p-2">
              {deliverableFiles.map((df, idx) => {
                const isActive = selectedDeliverable?.path === df.path;
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedDeliverable(df)}
                    className={`group p-1.5 rounded cursor-pointer text-xs font-mono transition-colors flex justify-between items-center ${
                      isActive
                        ? "bg-blue-50 border border-blue-200 text-[#0078D4] font-semibold"
                        : "hover:bg-gray-100 text-gray-700"
                    }`}
                  >
                    <span className="truncate flex-1 py-0.5">{df.path}</span>
                    <div className="flex items-center space-x-1 shrink-0">
                      <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 rounded border border-gray-200">{df.name.split('.').pop()}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDeliverable(df.path);
                        }}
                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                        title="Delete Deliverable File"
                        id={`btn-delete-deliverable-${idx}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {deliverableFiles.length === 0 && (
                <p className="text-[11px] text-gray-400 italic text-center p-4 leading-relaxed bg-gray-50 border border-dashed border-gray-200 rounded">
                  No files uploaded yet.<br/>
                  <span className="text-[10px] text-gray-400 font-sans block mt-1">Upload files under any task in the Workspace tab to populate this list.</span>
                </p>
              )}
            </div>
          </aside>

          {/* Deliverable editor and descriptions */}
          <main className="flex-1 flex flex-col bg-white min-h-0">
            {selectedDeliverable ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="p-3 bg-gray-50 border-b border-gray-300 flex items-center justify-between shadow-2xs">
                  <div>
                    <h3 className="text-xs font-bold text-gray-800 font-mono flex items-center gap-2">
                      <Code className="w-4 h-4 text-[#0078D4]" />
                      <span>{selectedDeliverable.path}</span>
                    </h3>
                    <p className="text-[10px] text-gray-500 font-mono mt-0.5">High optimization code block mapped to production environment.</p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(selectedDeliverable.content)}
                    className="bg-[#0078D4] hover:bg-[#005A9E] text-white text-xs font-semibold py-1.5 px-3 rounded flex items-center space-x-1.5 shadow-xs transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Snippet</span>
                  </button>
                </div>

                {(() => {
                  const isIdentical = (selectedDeliverable.baseContent || "").trim() === (selectedDeliverable.content || "").trim();
                  return (
                    <>
                      {isIdentical ? (
                        <div className="mx-4 my-2.5 p-3 bg-green-50 border border-green-200 rounded-md flex items-center justify-between shadow-2xs">
                          <div className="flex items-center gap-2">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
                            <span className="text-xs font-bold text-green-800 font-sans">✓ Code is Identical</span>
                          </div>
                          <span className="text-[11px] text-green-700 font-sans">
                            There are no active code differences or pending merge changes in this file snapshot.
                          </span>
                        </div>
                      ) : (
                        <div className="mx-4 my-2.5 p-3 bg-amber-50 border border-amber-200 rounded-md flex items-center justify-between shadow-2xs animate-pulse">
                          <div className="flex items-center gap-2">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                            <span className="text-xs font-bold text-amber-800 font-sans">⚡ Changes Detected</span>
                          </div>
                          <span className="text-[11px] text-amber-700 font-sans">
                            Highlighting active refactoring modifications, custom snapshots, or physical merges.
                          </span>
                        </div>
                      )}

                      <div className="flex-1 min-h-0">
                        <DiffEditor
                          height="100%"
                          language={
                            selectedDeliverable.name.endsWith(".cs")
                              ? "csharp"
                              : selectedDeliverable.name.endsWith(".sql")
                              ? "sql"
                              : selectedDeliverable.name.endsWith(".html")
                              ? "html"
                              : "typescript"
                          }
                          original={selectedDeliverable.baseContent || ""}
                          modified={selectedDeliverable.content || ""}
                          theme="vs"
                          options={{
                            readOnly: true,
                            originalEditable: false,
                            renderSideBySide: true,
                            fontSize: 12,
                            fontFamily: "'Fira Code', 'JetBrains Mono', monospace",
                            minimap: { enabled: true },
                            scrollBeyondLastLine: false
                          }}
                        />
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gray-50/50">
                <Code className="w-12 h-12 text-[#0078D4] mb-3 opacity-30" />
                <h4 className="text-sm font-bold text-gray-700">Enterprise Clean Architecture Viewer</h4>
                <p className="max-w-md text-xs text-gray-500 mt-2 font-sans leading-relaxed">
                  {deliverableFiles.length === 0
                    ? "Your physical file system is currently empty. Go to the Workspace tab, select a Task, and upload your files to see them sync and display here in real-time!"
                    : "Select an uploaded file from the sidebar of the Clean Architecture source tree to inspect its current content snapshot."}
                </p>
              </div>
            )}
          </main>
        </div>
      )}

      {/* METRICS & CHARTS TAB VIEW */}
      {activeTab === "metrics" && (
        <main className="flex-1 overflow-y-auto p-5 space-y-6 bg-[#F3F3F3]">
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            
            {/* Visual metrics bar charts */}
            <div className="p-4 bg-white border border-gray-300 rounded-xl flex flex-col h-[320px] shadow-xs">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block mb-3.5 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <TrendingUp className="w-4 h-4 text-[#0078D4]" />
                <span>Workspace Statistics</span>
              </span>
              <div className="flex-1 min-w-0 min-h-0">
                <ResponsiveContainer width="99%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart data={metricStatData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="name" stroke="#6b7280" fontSize={10} tickLine={false} />
                    <YAxis stroke="#6b7280" fontSize={10} tickLine={false} />
                    <Tooltip cursor={{ fill: '#F9FAFB' }} />
                    <Bar dataKey="value" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Line change density */}
            <div className="p-4 bg-white border border-gray-300 rounded-xl flex flex-col h-[320px] shadow-xs">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block mb-3.5 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <Layers className="w-4 h-4 text-purple-700" />
                <span>Impact Index by File Path</span>
              </span>
              <div className="flex-1 min-w-0 min-h-0">
                <ResponsiveContainer width="99%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart data={lineChangeCountData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis type="number" stroke="#6b7280" fontSize={10} />
                    <YAxis dataKey="name" type="category" stroke="#6b7280" fontSize={10} width={90} />
                    <Tooltip cursor={{ fill: '#F9FAFB' }} />
                    <Bar dataKey="Additions" fill="#107C41" radius={[0, 3, 3, 0]} stackId="a" />
                    <Bar dataKey="Deletions" fill="#A80000" radius={[0, 3, 3, 0]} stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Resolution completion pie */}
            <div className="p-4 bg-white border border-gray-300 rounded-xl flex flex-col justify-between h-[320px] shadow-xs">
              <div>
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block mb-1 flex items-center space-x-2 border-b border-gray-100 pb-2">
                  <Database className="w-4 h-4 text-emerald-600" />
                  <span>Conflict Resolution status</span>
                </span>
                <p className="text-[10px] text-gray-500 font-mono mt-1">Real-time resolution rates across active branch workspaces</p>
              </div>
              <div className="flex-1 flex justify-center items-center min-w-0 min-h-0">
                <ResponsiveContainer width="99%" height={150} minWidth={0} minHeight={0}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Resolved Conflicts", value: metrics.resolvedConflicts || 1 },
                        { name: "Active Conflicts", value: metrics.totalConflicts - metrics.resolvedConflicts || 1 }
                      ]}
                      innerRadius={45}
                      outerRadius={60}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      <Cell fill="#107C41" />
                      <Cell fill="#D13438" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-around text-[10px] font-mono border-t border-gray-100 pt-2">
                <div className="flex items-center space-x-1.5">
                  <div className="w-2.5 h-2.5 bg-[#107C41] rounded-full"></div>
                  <span>Resolved ({metrics.resolvedConflicts})</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <div className="w-2.5 h-2.5 bg-[#D13438] rounded-full"></div>
                  <span>Conflict Pending ({metrics.totalConflicts - metrics.resolvedConflicts})</span>
                </div>
              </div>
            </div>

          </div>

          {/* Large text documentation layout */}
          <section className="bg-white border border-gray-300 rounded-xl p-5 text-gray-700 space-y-3 shadow-xs">
            <h3 className="text-xs font-extrabold text-gray-800 uppercase tracking-wider flex items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-[#0078D4]" />
              <span>Enterprise Integration Architecture & DevOps Blueprint</span>
            </h3>
            <p className="leading-relaxed text-xs">
              The CodeShield Workspace links clean <strong>Angular 18 elements</strong> with an <strong>ASP.NET Core Web API 8.0 server</strong> mapping directly to <strong>SQL Database schemas</strong>. Automatic git hooks monitor dynamic conflict points inside your solution explorer snapshot stack, preventing regression faults and predicting code-merge blockages before final commit verification checks.
            </p>
          </section>

        </main>
      )}

      {/* 4. SOLID BLUE MICROSOFT SYSTEM FOOTER */}
      <footer className="bg-[#0078D4] text-white h-6 flex items-center px-3 justify-between text-[10px] shrink-0 font-mono select-none z-20">
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-1">
            <span className="opacity-75 font-semibold">Active Snapshot:</span>
            <span>{selectedFile ? selectedFile.fileName : "No Active Selection"}</span>
          </div>
          <div className="flex items-center gap-1 hidden sm:flex">
            <span className="opacity-75 font-semibold">Enc:</span>
            <span>UTF-8</span>
          </div>
          <div className="flex items-center gap-1 hidden sm:flex">
            <span className="opacity-75 font-semibold">Host Node:</span>
            <span>https://localhost:3000</span>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-1 px-1.5 bg-white/10 rounded cursor-pointer hover:bg-white/25 transition-colors">
            {metrics.totalConflicts > 0 ? `${metrics.totalConflicts} Conflict Alerts` : "Perfect Sync"}
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-300 animate-pulse"></span>
            <span className="opacity-90">Enterprise Git Service Connected</span>
          </div>
        </div>
      </footer>

      {/* 5. MODALS - CREATE TASK RECORD OVERLAY */}
      {isNewTaskModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade backdrop-blur-xs">
          <div className="bg-white border border-gray-300 w-full max-w-sm rounded-lg p-4 space-y-3.5 shadow-2xl text-gray-700">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <span className="text-xs font-bold text-gray-800 flex items-center space-x-2">
                <PlusCircle className="w-4 h-4 text-[#0078D4]" />
                <span>Create CodeShield Task</span>
              </span>
              <button
                onClick={() => setIsNewTaskModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-extrabold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3 font-mono text-[11px] text-gray-600">
              <div>
                <label className="block mb-0.5 text-[9px] text-gray-500 uppercase font-bold tracking-wider">Task ID:</label>
                <input
                  type="text"
                  required
                  value={newTaskForm.taskId}
                  onChange={(e) => setNewTaskForm(prev => ({ ...prev, taskId: e.target.value }))}
                  className="w-full bg-white border border-gray-300 rounded px-2.5 py-1 outline-none text-gray-800 focus:border-[#0078D4]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block mb-0.5 text-[9px] text-gray-500 uppercase font-bold tracking-wider">Base Branch:</label>
                  <input
                    type="text"
                    required
                    value={newTaskForm.baseBranch}
                    onChange={(e) => setNewTaskForm(prev => ({ ...prev, baseBranch: e.target.value }))}
                    className="w-full bg-white border border-gray-300 rounded px-2.5 py-1 outline-none text-gray-800 focus:border-[#0078D4]"
                  />
                </div>
                <div>
                  <label className="block mb-0.5 text-[9px] text-gray-500 uppercase font-bold tracking-wider">Feature Branch:</label>
                  <input
                    type="text"
                    required
                    value={newTaskForm.featureBranch}
                    onChange={(e) => setNewTaskForm(prev => ({ ...prev, featureBranch: e.target.value }))}
                    className="w-full bg-white border border-gray-300 rounded px-2.5 py-1 outline-none text-gray-800 focus:border-[#0078D4]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block mb-0.5 text-[9px] text-gray-500 uppercase font-bold tracking-wider">Developer:</label>
                  <input
                    type="text"
                    required
                    value={newTaskForm.developer}
                    onChange={(e) => setNewTaskForm(prev => ({ ...prev, developer: e.target.value }))}
                    className="w-full bg-white border border-gray-300 rounded px-2.5 py-1 outline-none text-gray-800 focus:border-[#0078D4]"
                  />
                </div>
                <div>
                  <label className="block mb-0.5 text-[9px] text-gray-500 uppercase font-bold tracking-wider">Repository:</label>
                  <input
                    type="text"
                    value={newTaskForm.repositoryUrl}
                    onChange={(e) => setNewTaskForm(prev => ({ ...prev, repositoryUrl: e.target.value }))}
                    className="w-full bg-white border border-gray-300 rounded px-2.5 py-1 outline-none text-gray-800 focus:border-[#0078D4]"
                  />
                </div>
              </div>
              <div>
                <label className="block mb-0.5 text-[9px] text-gray-500 uppercase font-bold tracking-wider">Description Scope:</label>
                <textarea
                  rows={2}
                  required
                  value={newTaskForm.description}
                  onChange={(e) => setNewTaskForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-white border border-gray-300 rounded px-2.5 py-1.5 outline-none text-gray-800 focus:border-[#0078D4] resize-none"
                />
              </div>

              <div className="pt-2.5 flex justify-end space-x-1.5 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsNewTaskModalOpen(false)}
                  className="border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded text-xs text-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#0078D4] hover:bg-[#005A9E] text-white font-semibold px-3 py-1.5 rounded text-xs transition-colors shadow-xs"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Non-Blocking Custom Confirmation Dialog Overlay */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-lg border border-gray-200 shadow-xl max-w-md w-full overflow-hidden animate-scale-up animate-duration-150">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <span className="font-bold text-gray-800 text-sm flex items-center gap-1.5 font-sans">
                <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                {confirmDialog.title}
              </span>
              <button
                onClick={() => setConfirmDialog(p => ({ ...p, isOpen: false }))}
                className="text-gray-400 hover:text-gray-600 font-sans text-lg font-semibold leading-none p-1"
                title="Cancel Action"
                id="btn-close-confirm-modal"
              >
                &times;
              </button>
            </div>
            
            <div className="p-5">
              <p className="text-xs text-gray-600 leading-relaxed font-sans prose">
                {confirmDialog.message}
              </p>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end space-x-2">
              <button
                onClick={() => setConfirmDialog(p => ({ ...p, isOpen: false }))}
                className="px-3.5 py-1.5 border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-semibold rounded-md transition-all font-sans cursor-pointer"
                id="btn-cancel-confirm-modal"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-md shadow-xs hover:shadow-md transition-all font-sans cursor-pointer"
                id="btn-execute-confirm-modal"
              >
                {confirmDialog.confirmText || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
