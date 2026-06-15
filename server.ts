import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";

// Helper for Vercel/Serverless compatible writable folder
const getEnterpriseDir = (): string => {
  return process.env.VERCEL 
    ? path.join("/tmp", "enterprise-source")
    : path.join(process.cwd(), "enterprise-source");
};

// Helper to recursively delete empty sub-folders to keep clean tree
const deleteEmptyDirectories = (dir: string) => {
  try {
    if (!fs.existsSync(dir)) return;
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return;

    let items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const isStateFile = ["tasks.json", "files.json", "conflicts.json", "recommendations.json", "seed-v4.lock", "seed-clean.lock"].includes(item.toLowerCase());
      if (!isStateFile) {
        deleteEmptyDirectories(fullPath);
      }
    }

    // Check again
    items = fs.readdirSync(dir);
    if (items.length === 0 && dir !== getEnterpriseDir()) {
      fs.rmdirSync(dir);
      console.log(`Cleaned empty workspace subdirectory physically: ${dir}`);
    }
  } catch (e) {
    console.warn("Directory clean error:", e);
  }
};

// ==========================================
// 1. Core State Store & MS SQL Connection
// ==========================================
let codeTasks: any[] = [];
let taskFiles: any[] = [];
let taskConflicts: any[] = [];
let aiRecommendations: any[] = [];

// Standard seed data to keep workspace always live and initialized elegantly
const DEFAULT_TASKS = [
  {
    taskId: "TASK-1001",
    baseBranch: "main",
    featureBranch: "feature/payment-pooling",
    description: "Troubleshoot connection leaks and optimize payment merchant gateway client pool size.",
    developer: "Marcus Chen",
    createdDate: "2026-06-10T08:30:00.000Z",
    repositoryUrl: "https://github.com/enterprise/gateway-pay.git",
    commitId: "m_db9aef2"
  },
  {
    taskId: "TASK-1002",
    baseBranch: "main",
    featureBranch: "feature/billing-routing",
    description: "Deploy memory-efficient streaming middleware for bulk telemetry billing export.",
    developer: "Diana Prince",
    createdDate: "2026-06-12T14:15:00.000Z",
    repositoryUrl: "https://github.com/enterprise/billing-api.git",
    commitId: "m_6fb402a"
  },
  {
    taskId: "TASK-1003",
    baseBranch: "main",
    featureBranch: "feature/order-stripe-sync",
    description: "Merge master into stripe feature branch and resolve critical checkout conflict on OrderService.cs.",
    developer: "Clara Oswald",
    createdDate: "2026-06-14T11:05:00.000Z",
    repositoryUrl: "https://github.com/enterprise/checkout-service.git",
    commitId: "m_e89100c"
  }
];

const DEFAULT_FILES = [
  {
    id: "file_1001_1",
    taskId: "TASK-1001",
    fileName: "PaymentController.cs",
    path: "Controllers/PaymentController.cs",
    extension: "cs",
    baseContent: `using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace GatewayPay.Controllers
{
    [ApiController]
    [Route("api/payments")]
    public class PaymentController : ControllerBase
    {
        private readonly IMerchantClient _merchantClient;

        public PaymentController(IMerchantClient merchantClient)
        {
            _merchantClient = merchantClient;
        }

        [HttpPost("charge")]
        public async Task<IActionResult> ChargePayment([FromBody] ChargeRequest request)
        {
            // Execute payment processing task
            var response = await _merchantClient.ProcessChargeAsync(request.Payload);
            return Ok(response);
        }
    }
}`,
    featureContent: `using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace GatewayPay.Controllers
{
    [ApiController]
    [Route("api/payments")]
    public class PaymentController : ControllerBase
    {
        private readonly IMerchantClientFactory _clientFactory;
        private readonly IPoolLogger _logger;

        public PaymentController(IMerchantClientFactory clientFactory, IPoolLogger logger)
        {
            _clientFactory = clientFactory;
            _logger = logger;
        }

        [HttpPost("charge")]
        public async Task<IActionResult> ChargePayment([FromBody] ChargeRequest request)
        {
            _logger.LogTrace("Acquiring connection from client pool...");
            using (var client = _clientFactory.AcquireClient())
            {
                var response = await client.ProcessChargeAsync(request.Payload);
                _logger.LogTrace("Releasing connection back to pooled client gateway.");
                return Ok(response);
            }
        }
    }
}`,
    resolvedContent: "",
    isConflict: false,
    isResolved: false
  },
  {
    id: "file_1001_2",
    taskId: "TASK-1001",
    fileName: "ClientPool.cs",
    path: "Infrastructure/ClientPool.cs",
    extension: "cs",
    baseContent: `using System;
using System.Collections.Generic;

namespace GatewayPay.Infrastructure
{
    public class ClientPool
    {
        private readonly int _maxSize = 10;
        
        public ClientPool()
        {
        }
    }
}`,
    featureContent: `using System;
using System.Collections.Concurrent;
using System.Threading;

namespace GatewayPay.Infrastructure
{
    public class ClientPool : IDisposable
    {
        private readonly int _maxSize = 120; // Increased to prevent checkout exhaustion
        private readonly ConcurrentBag<IMerchantClient> _pool;
        private int _allocatedCount = 0;

        public ClientPool(int maxSize)
        {
            _maxSize = maxSize;
            _pool = new ConcurrentBag<IMerchantClient>();
        }

        public IMerchantClient Checkout()
        {
            if (_pool.TryTake(out var client))
            {
                return client;
            }

            if (Interlocked.Increment(ref _allocatedCount) <= _maxSize)
            {
                return new MerchantClient();
            }

            Interlocked.Decrement(ref _allocatedCount);
            throw new InvalidOperationException("Merchant Client Gateway connection pooling exhausted!");
        }

        public void Release(IMerchantClient client)
        {
            if (client != null)
            {
                _pool.Add(client);
            }
        }

        public void Dispose()
        {
            while(_pool.TryTake(out var client))
            {
                client?.Dispose();
            }
        }
    }
}`,
    resolvedContent: "",
    isConflict: false,
    isResolved: false
  },
  {
    id: "file_1002_1",
    taskId: "TASK-1002",
    fileName: "BillingRouter.cs",
    path: "Middleware/BillingRouter.cs",
    extension: "cs",
    baseContent: `using System;
using System.IO;
using Microsoft.AspNetCore.Http;

namespace BillingApi.Middleware
{
    public class BillingRouter
    {
        private readonly RequestDelegate _next;

        public BillingRouter(RequestDelegate next)
        {
            _next = next;
        }

        public async Task Invoke(HttpContext context)
        {
            await _next(context);
        }
    }
}`,
    featureContent: `using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace BillingApi.Middleware
{
    public class BillingRouter
    {
        private readonly RequestDelegate _next;
        private readonly IBillingStore _store;

        public BillingRouter(RequestDelegate next, IBillingStore store)
        {
            _next = next;
            _store = store;
        }

        public async Task Invoke(HttpContext context)
        {
            if (context.Request.Path.StartsWithSegments("/api/telemetry/bill"))
            {
                context.Response.ContentType = "application/json";
                using (var streamWriter = new StreamWriter(context.Response.Body))
                {
                    await foreach (var row in _store.GetStreamableBillingBatchesAsync())
                    {
                        var json = JsonSerializer.Serialize(row);
                        await streamWriter.WriteLineAsync(json);
                        await streamWriter.FlushAsync();
                    }
                }
                return;
            }
            await _next(context);
        }
    }
}`,
    resolvedContent: "",
    isConflict: false,
    isResolved: false
  },
  {
    id: "file_1003_1",
    taskId: "TASK-1003",
    fileName: "OrderService.cs",
    path: "Services/OrderService.cs",
    extension: "cs",
    baseContent: `using System;
using System.Threading.Tasks;

namespace CheckoutService.Services
{
    public class OrderService
    {
        public async Task<OrderResponse> ProcessOrderAsync(OrderRequest request)
        {
            Console.WriteLine("Processing customer checkout order...");
            return new OrderResponse { Success = true };
        }
    }
}`,
    featureContent: `using System;
using System.Threading.Tasks;

namespace CheckoutService.Services
{
    public class OrderService
    {
<<<<<<< HEAD
        public async Task<OrderResponse> ProcessOrderAsync(OrderRequest request)
        {
            // Charge legacy payment merchant system (Fallback payment provider)
            var response = await _legacyGateway.ChargeAsync(request.UserId, request.Subtotal);
            return new OrderResponse { Success = response.Success, Code = "LEGACY_PAY" };
        }
=======
        public async Task<OrderResponse> ProcessOrderAsync(OrderRequest request)
        {
            // Stripe API Integration (Modern Checkout pipeline)
            var session = await _stripeService.CreateSessionAsync(request.Email, request.Subtotal);
            return new OrderResponse { Success = session.IsActive, Code = "STRIPE_SUCCESS" };
        }
>>>>>>> feature/stripe-payment
    }
}`,
    resolvedContent: "",
    isConflict: true,
    isResolved: false
  }
];

// Check if MSSQL is configured in environment
const isMssqlConfigured = (): boolean => {
  return !!(
    process.env.DB_CONNECTION_STRING ||
    process.env.MSSQL_CONNECTION_STRING ||
    (process.env.DB_SERVER && process.env.DB_USER)
  );
};

let dbPool: any = null;
let mssqlError: string | null = null;
let mssqlLib: any = null;

// Lazy module loader helper to completely split packages resolution on Vercel lambda cold boots
const loadMssql = async () => {
  if (!mssqlLib) {
    mssqlLib = await import("mssql");
  }
  return mssqlLib;
};

const getMssqlConfig = () => {
  const connectionString = process.env.DB_CONNECTION_STRING || process.env.MSSQL_CONNECTION_STRING;
  if (connectionString) {
    return connectionString;
  }
  return {
    user: process.env.DB_USER || "sa",
    password: process.env.DB_PASSWORD || "",
    server: process.env.DB_SERVER || "",
    port: parseInt(process.env.DB_PORT || "1433", 10),
    database: process.env.DB_NAME || "CodeChangeManagerDb",
    options: {
      encrypt: true,
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== "false"
    },
    connectionTimeout: 15000,
    requestTimeout: 15000
  };
};

const getDbPool = async (): Promise<any | null> => {
  if (!isMssqlConfigured()) return null;
  if (dbPool) return dbPool;

  try {
    const mssql = await loadMssql();
    const config = getMssqlConfig();
    console.log("Connecting to Microsoft SQL Server...");
    dbPool = await mssql.connect(config);
    console.log("Joined Microsoft SQL Server successfully!");
    
    // Autoseed database tables if they are active but empty
    await seedDbIfEmpty(dbPool);

    mssqlError = null;
    return dbPool;
  } catch (err: any) {
    console.error("Database connection failure:", err);
    mssqlError = err.message || String(err);
    dbPool = null;
    return null;
  }
};

const seedDbIfEmpty = async (pool: any) => {
  try {
    const checkTasks = await pool.request().query("SELECT COUNT(*) as cnt FROM dbo.CodeTasks");
    if (checkTasks.recordset[0]?.cnt === 0) {
      console.log("Database tables are empty. Pre-seeding default enterprise tasks and files...");
      const mssql = await loadMssql();
      
      // Save Tasks
      for (const t of DEFAULT_TASKS) {
        const req = pool.request();
        req.input("TaskId", mssql.NVarChar(100), t.taskId);
        req.input("BaseBranch", mssql.NVarChar(100), t.baseBranch);
        req.input("FeatureBranch", mssql.NVarChar(100), t.featureBranch);
        req.input("Description", mssql.NVarChar(mssql.MAX), t.description);
        req.input("Developer", mssql.NVarChar(100), t.developer);
        req.input("CreatedDate", mssql.DateTime2, new Date(t.createdDate));
        req.input("RepositoryUrl", mssql.NVarChar(2083), t.repositoryUrl);
        req.input("CommitId", mssql.NVarChar(100), t.commitId);
        await req.query(`
          INSERT INTO dbo.CodeTasks (TaskId, BaseBranch, FeatureBranch, Description, Developer, CreatedDate, RepositoryUrl, CommitId)
          VALUES (@TaskId, @BaseBranch, @FeatureBranch, @Description, @Developer, @CreatedDate, @RepositoryUrl, @CommitId)
        `);
      }

      // Save Files
      for (const f of DEFAULT_FILES) {
        const req = pool.request();
        req.input("Id", mssql.NVarChar(100), f.id);
        req.input("TaskId", mssql.NVarChar(100), f.taskId);
        req.input("FileName", mssql.NVarChar(255), f.fileName);
        req.input("Path", mssql.NVarChar(1000), f.path);
        req.input("Extension", mssql.NVarChar(50), f.extension);
        req.input("BaseContent", mssql.NVarChar(mssql.MAX), f.baseContent);
        req.input("FeatureContent", mssql.NVarChar(mssql.MAX), f.featureContent);
        req.input("ResolvedContent", mssql.NVarChar(mssql.MAX), f.resolvedContent);
        req.input("IsConflict", mssql.Bit, f.isConflict ? 1 : 0);
        req.input("IsResolved", mssql.Bit, f.isResolved ? 1 : 0);

        await req.query(`
          INSERT INTO dbo.TaskFiles (Id, TaskId, FileName, Path, Extension, BaseContent, FeatureContent, ResolvedContent, IsConflict, IsResolved)
          VALUES (@Id, @TaskId, @FileName, @Path, @Extension, @BaseContent, @FeatureContent, @ResolvedContent, @IsConflict, @IsResolved)
        `);

        if (f.isConflict) {
          const confReq = pool.request();
          confReq.input("Id", mssql.NVarChar(100), "c_" + f.id.replace("file_", ""));
          confReq.input("TaskId", mssql.NVarChar(100), f.taskId);
          confReq.input("FileId", mssql.NVarChar(100), f.id);
          confReq.input("ConflictText", mssql.NVarChar(mssql.MAX), f.featureContent);
          confReq.input("Resolution", mssql.NVarChar(mssql.MAX), f.resolvedContent);
          confReq.input("AuditTrail", mssql.NVarChar(mssql.MAX), JSON.stringify([
            `System: Merge conflicts pre-seeded on database setup inside ${f.fileName}`
          ]));

          await confReq.query(`
            INSERT INTO dbo.TaskConflicts (Id, TaskId, FileId, ConflictText, Resolution, AuditTrail)
            VALUES (@Id, @TaskId, @FileId, @ConflictText, @Resolution, @AuditTrail)
          `);
        }
      }

      console.log("Microsoft SQL database pre-seeded successfully!");
    }
  } catch (err) {
    console.warn("DB Pre-seed skipped or tables not built yet:", err);
  }
};

// DB Helper functions as lazy wrappers for all API models
const getCodeTasksFromDb = async (): Promise<any[]> => {
  const pool = await getDbPool();
  if (!pool) return codeTasks;
  const result = await pool.request().query("SELECT * FROM dbo.CodeTasks ORDER BY CreatedDate DESC");
  return result.recordset.map((row: any) => ({
    taskId: row.TaskId,
    baseBranch: row.BaseBranch,
    featureBranch: row.FeatureBranch,
    description: row.Description,
    developer: row.Developer,
    createdDate: row.CreatedDate,
    repositoryUrl: row.RepositoryUrl,
    commitId: row.CommitId
  }));
};

const saveCodeTaskToDb = async (task: any): Promise<boolean> => {
  const pool = await getDbPool();
  if (!pool) {
    const exists = codeTasks.some(t => String(t.taskId).toUpperCase() === String(task.taskId).toUpperCase());
    if (!exists) {
      codeTasks.push(task);
      saveAppState();
    }
    return true;
  }
  
  const mssql = await loadMssql();
  const request = pool.request();
  request.input("TaskId", mssql.NVarChar(100), task.taskId);
  request.input("BaseBranch", mssql.NVarChar(100), task.baseBranch || "main");
  request.input("FeatureBranch", mssql.NVarChar(100), task.featureBranch || "");
  request.input("Description", mssql.NVarChar(mssql.MAX), task.description || "");
  request.input("Developer", mssql.NVarChar(100), task.developer || "Lead Developer");
  request.input("CreatedDate", mssql.DateTime2, task.createdDate ? new Date(task.createdDate) : new Date());
  request.input("RepositoryUrl", mssql.NVarChar(2083), task.repositoryUrl || "https://github.com/enterprise/source.git");
  request.input("CommitId", mssql.NVarChar(100), task.commitId || "");

  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.CodeTasks WHERE TaskId = @TaskId)
    BEGIN
      INSERT INTO dbo.CodeTasks (TaskId, BaseBranch, FeatureBranch, Description, Developer, CreatedDate, RepositoryUrl, CommitId)
      VALUES (@TaskId, @BaseBranch, @FeatureBranch, @Description, @Developer, @CreatedDate, @RepositoryUrl, @CommitId)
    END
  `);
  return true;
};

const deleteCodeTaskFromDb = async (taskId: string): Promise<boolean> => {
  const pool = await getDbPool();
  if (!pool) {
    const targetId = taskId.toUpperCase();
    const matchTask = (id: string) => String(id || "").toUpperCase() === targetId || String(id || "").toUpperCase() === `TASK-${targetId}` || `TASK-${String(id || "").toUpperCase()}` === targetId;
    codeTasks = codeTasks.filter(t => !matchTask(t.taskId));
    taskFiles = taskFiles.filter(f => !matchTask(f.taskId));
    taskConflicts = taskConflicts.filter(c => !matchTask(c.taskId));
    aiRecommendations = aiRecommendations.filter(r => !matchTask(r.taskId));
    saveAppState();
    return true;
  }

  const mssql = await loadMssql();
  const transaction = new mssql.Transaction(pool);
  try {
    await transaction.begin();
    await transaction.request().input("TaskId", mssql.NVarChar(100), taskId).query("DELETE FROM dbo.TaskConflicts WHERE TaskId = @TaskId");
    await transaction.request().input("TaskId", mssql.NVarChar(100), taskId).query("DELETE FROM dbo.TaskFiles WHERE TaskId = @TaskId");
    await transaction.request().input("TaskId", mssql.NVarChar(100), taskId).query("DELETE FROM dbo.AiRecommendations WHERE TaskId = @TaskId");
    await transaction.request().input("TaskId", mssql.NVarChar(100), taskId).query("DELETE FROM dbo.CodeTasks WHERE TaskId = @TaskId");
    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

const getTaskFilesFromDb = async (taskId: string): Promise<any[]> => {
  const pool = await getDbPool();
  const targetId = taskId.toUpperCase();
  if (!pool) {
    return taskFiles.filter(f => {
      const fid = String(f.taskId || "").toUpperCase();
      return fid === targetId || fid === `TASK-${targetId}` || `TASK-${fid}` === targetId;
    });
  }

  const mssql = await loadMssql();
  const result = await pool.request()
    .input("TaskId", mssql.NVarChar(100), taskId)
    .query("SELECT * FROM dbo.TaskFiles WHERE TaskId = @TaskId OR 'TASK-' + UPPER(TaskId) = @TaskId OR UPPER(TaskId) = 'TASK-' + @TaskId");

  return result.recordset.map((row: any) => ({
    id: row.Id,
    taskId: row.TaskId,
    fileName: row.FileName,
    path: row.Path,
    extension: row.Extension,
    baseContent: row.BaseContent,
    featureContent: row.FeatureContent,
    resolvedContent: row.ResolvedContent,
    isConflict: row.IsConflict,
    isResolved: row.IsResolved
  }));
};

const saveTaskFileToDb = async (file: any): Promise<boolean> => {
  const pool = await getDbPool();
  if (!pool) {
    const idx = taskFiles.findIndex(f => f.id === file.id);
    if (idx !== -1) {
      taskFiles[idx] = file;
    } else {
      taskFiles.push(file);
    }
    saveAppState();
    return true;
  }

  const mssql = await loadMssql();
  const request = pool.request();
  request.input("Id", mssql.NVarChar(100), file.id);
  request.input("TaskId", mssql.NVarChar(100), file.taskId);
  request.input("FileName", mssql.NVarChar(255), file.fileName);
  request.input("Path", mssql.NVarChar(1000), file.path);
  request.input("Extension", mssql.NVarChar(50), file.extension);
  request.input("BaseContent", mssql.NVarChar(mssql.MAX), file.baseContent || "");
  request.input("FeatureContent", mssql.NVarChar(mssql.MAX), file.featureContent || "");
  request.input("ResolvedContent", mssql.NVarChar(mssql.MAX), file.resolvedContent || "");
  request.input("IsConflict", mssql.Bit, file.isConflict ? 1 : 0);
  request.input("IsResolved", mssql.Bit, file.isResolved ? 1 : 0);

  await pool.request()
    .input("TaskId", mssql.NVarChar(100), file.taskId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.CodeTasks WHERE TaskId = @TaskId)
      BEGIN
        INSERT INTO dbo.CodeTasks (TaskId, BaseBranch, FeatureBranch, Description, Developer, CreatedDate, RepositoryUrl, CommitId)
        VALUES (@TaskId, 'main', 'feature-' + LOWER(@TaskId), 'Auto-seeded task during file save', 'Lead Developer', GETUTCDATE(), 'https://github.com/enterprise/source.git', 'init')
      END
    `);

  await request.query(`
    IF EXISTS (SELECT 1 FROM dbo.TaskFiles WHERE Id = @Id)
    BEGIN
      UPDATE dbo.TaskFiles
      SET FileName = @FileName, Path = @Path, Extension = @Extension, BaseContent = @BaseContent,
          FeatureContent = @FeatureContent, ResolvedContent = @ResolvedContent, 
          IsConflict = @IsConflict, IsResolved = @IsResolved
      WHERE Id = @Id
    END
    ELSE
    BEGIN
      INSERT INTO dbo.TaskFiles (Id, TaskId, FileName, Path, Extension, BaseContent, FeatureContent, ResolvedContent, IsConflict, IsResolved)
      VALUES (@Id, @TaskId, @FileName, @Path, @Extension, @BaseContent, @FeatureContent, @ResolvedContent, @IsConflict, @IsResolved)
    END
  `);

  if (file.isConflict) {
    const conflictRequest = pool.request();
    conflictRequest.input("Id", mssql.NVarChar(100), "c_" + file.id.replace("file_", ""));
    conflictRequest.input("TaskId", mssql.NVarChar(100), file.taskId);
    conflictRequest.input("FileId", mssql.NVarChar(100), file.id);
    conflictRequest.input("ConflictText", mssql.NVarChar(mssql.MAX), file.featureContent || "");
    conflictRequest.input("Resolution", mssql.NVarChar(mssql.MAX), file.resolvedContent || "");
    conflictRequest.input("AuditTrail", mssql.NVarChar(mssql.MAX), JSON.stringify([
      `System: Merge conflicts detected on file upload inside ${file.fileName}`
    ]));

    await conflictRequest.query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.TaskConflicts WHERE FileId = @FileId)
      BEGIN
        INSERT INTO dbo.TaskConflicts (Id, TaskId, FileId, ConflictText, Resolution, AuditTrail)
        VALUES (@Id, @TaskId, @FileId, @ConflictText, @Resolution, @AuditTrail)
      END
      ELSE
      BEGIN
        UPDATE dbo.TaskConflicts
        SET ConflictText = @ConflictText, Resolution = @Resolution
        WHERE FileId = @FileId
      END
    `);
  } else {
    await pool.request()
      .input("FileId", mssql.NVarChar(100), file.id)
      .input("Resolution", mssql.NVarChar(mssql.MAX), file.featureContent || "")
      .query(`
        UPDATE dbo.TaskConflicts
        SET Resolution = @Resolution
        WHERE FileId = @FileId
      `);
  }

  return true;
};

const deleteTaskFileFromDb = async (fileId: string): Promise<boolean> => {
  const pool = await getDbPool();
  if (!pool) {
    taskFiles = taskFiles.filter(f => f.id !== fileId);
    taskConflicts = taskConflicts.filter(c => c.fileId !== fileId);
    saveAppState();
    return true;
  }

  const mssql = await loadMssql();
  await pool.request()
    .input("Id", mssql.NVarChar(100), fileId)
    .query("DELETE FROM dbo.TaskFiles WHERE Id = @Id");

  return true;
};

const getTaskFileByIdFromDb = async (fileId: string): Promise<any | null> => {
  const pool = await getDbPool();
  if (!pool) {
    return taskFiles.find(f => f.id === fileId) || null;
  }

  const mssql = await loadMssql();
  const result = await pool.request()
    .input("Id", mssql.NVarChar(100), fileId)
    .query("SELECT * FROM dbo.TaskFiles WHERE Id = @Id");

  if (result.recordset.length === 0) return null;
  const row = result.recordset[0];
  return {
    id: row.Id,
    taskId: row.TaskId,
    fileName: row.FileName,
    path: row.Path,
    extension: row.Extension,
    baseContent: row.BaseContent,
    featureContent: row.FeatureContent,
    resolvedContent: row.ResolvedContent,
    isConflict: row.IsConflict,
    isResolved: row.IsResolved
  };
};

const resolveMergeConflictInDb = async (fileId: string, resolution: string, actionName: string): Promise<any | null> => {
  const pool = await getDbPool();
  if (!pool) {
    const file = taskFiles.find(f => f.id === fileId);
    if (!file) return null;
    file.resolvedContent = resolution;
    file.isResolved = true;
    
    const conflict = taskConflicts.find(c => c.fileId === fileId);
    if (conflict) {
      conflict.resolution = resolution;
      conflict.auditTrail.push(`Developer resolved conflict dynamically using command: "Accept ${actionName || 'Manual'}" at ${new Date().toLocaleString()}`);
    }
    saveAppState();
    return file;
  }

  const mssql = await loadMssql();
  await pool.request()
    .input("Id", mssql.NVarChar(100), fileId)
    .input("Resolution", mssql.NVarChar(mssql.MAX), resolution)
    .query("UPDATE dbo.TaskFiles SET ResolvedContent = @Resolution, IsResolved = 1 WHERE Id = @Id");

  const auditMessage = `Developer resolved conflict dynamically using command: "Accept ${actionName || 'Manual'}" at ${new Date().toLocaleString()}`;

  const result = await pool.request()
    .input("FileId", mssql.NVarChar(100), fileId)
    .query("SELECT AuditTrail FROM dbo.TaskConflicts WHERE FileId = @FileId");

  let auditTrail = [];
  if (result.recordset.length > 0 && result.recordset[0].AuditTrail) {
    try {
      auditTrail = JSON.parse(result.recordset[0].AuditTrail);
    } catch (_) {
      auditTrail = [String(result.recordset[0].AuditTrail)];
    }
  }
  auditTrail.push(auditMessage);

  await pool.request()
    .input("FileId", mssql.NVarChar(100), fileId)
    .input("Resolution", mssql.NVarChar(mssql.MAX), resolution)
    .input("AuditTrail", mssql.NVarChar(mssql.MAX), JSON.stringify(auditTrail))
    .query("UPDATE dbo.TaskConflicts SET Resolution = @Resolution, AuditTrail = @AuditTrail WHERE FileId = @FileId");

  return await getTaskFileByIdFromDb(fileId);
};

const getRecommendationsFromDb = async (taskId: string): Promise<any[]> => {
  const pool = await getDbPool();
  const targetId = taskId.toUpperCase();
  if (!pool) {
    return aiRecommendations.filter(r => {
      const r_id = String(r.taskId || "").toUpperCase();
      const target = taskId.toUpperCase();
      return r_id === target || r_id === `TASK-${target}` || `TASK-${r_id}` === target;
    });
  }

  const mssql = await loadMssql();
  const result = await pool.request()
    .input("TaskId", mssql.NVarChar(100), taskId)
    .query("SELECT * FROM dbo.AiRecommendations WHERE TaskId = @TaskId");

  return result.recordset.map((row: any) => ({
    id: row.Id,
    taskId: row.TaskId,
    category: row.Category,
    recommendationText: row.RecommendationText
  }));
};

const saveRecommendationsToDb = async (taskId: string, recs: any[]): Promise<boolean> => {
  const pool = await getDbPool();
  if (!pool) {
    aiRecommendations = aiRecommendations.filter(r => {
      const rid = String(r.taskId || "").toUpperCase();
      const target = taskId.toUpperCase();
      return rid !== target && rid !== `TASK-${target}` && `TASK-${rid}` !== target;
    }).concat(recs);
    saveAppState();
    return true;
  }

  const mssql = await loadMssql();
  const transaction = new mssql.Transaction(pool);
  try {
    await transaction.begin();
    await transaction.request()
      .input("TaskId", mssql.NVarChar(100), taskId)
      .query("DELETE FROM dbo.AiRecommendations WHERE TaskId = @TaskId");

    for (const rec of recs) {
      await transaction.request()
        .input("Id", mssql.NVarChar(100), rec.id)
        .input("TaskId", mssql.NVarChar(100), taskId)
        .input("Category", mssql.NVarChar(100), rec.category)
        .input("RecommendationText", mssql.NVarChar(mssql.MAX), rec.recommendationText)
        .query("INSERT INTO dbo.AiRecommendations (Id, TaskId, Category, RecommendationText) VALUES (@Id, @TaskId, @Category, @RecommendationText)");
    }
    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

const getDashboardMetricsFromDb = async (): Promise<any> => {
  const pool = await getDbPool();
  if (!pool) {
    const totalTasks = codeTasks.length;
    const totalConflicts = taskFiles.filter(f => f.isConflict).length;
    const resolvedConflicts = taskFiles.filter(f => f.isConflict && f.isResolved).length;
    const filesChanged = taskFiles.length;
    return { totalTasks, totalConflicts, resolvedConflicts, filesChanged };
  }

  try {
    const tasksCountRes = await pool.request().query("SELECT COUNT(*) as cnt FROM dbo.CodeTasks");
    const conflictsCountRes = await pool.request().query("SELECT COUNT(*) as cnt FROM dbo.TaskFiles WHERE IsConflict = 1");
    const resolvedCountRes = await pool.request().query("SELECT COUNT(*) as cnt FROM dbo.TaskFiles WHERE IsConflict = 1 AND IsResolved = 1");
    const filesCountRes = await pool.request().query("SELECT COUNT(*) as cnt FROM dbo.TaskFiles");

    return {
      totalTasks: tasksCountRes.recordset[0]?.cnt || 0,
      totalConflicts: conflictsCountRes.recordset[0]?.cnt || 0,
      resolvedConflicts: resolvedCountRes.recordset[0]?.cnt || 0,
      filesChanged: filesCountRes.recordset[0]?.cnt || 0
    };
  } catch (e) {
    return { totalTasks: 0, totalConflicts: 0, resolvedConflicts: 0, filesChanged: 0 };
  }
};

const getDeliverablesFromDb = async (): Promise<any[]> => {
  const pool = await getDbPool();
  if (!pool) {
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
          const isMetadata = ["tasks.json", "files.json", "conflicts.json", "recommendations.json", "seed-v4.lock", "seed-clean.lock"].includes(item.toLowerCase());
          if (isMetadata) continue;

          const content = fs.readFileSync(fullPath, "utf-8");
          const matchingFile = taskFiles.find(tf => {
            const p1 = String(tf.path || "").replace(/\\/g, "/").toLowerCase();
            const p2 = String(relative || "").replace(/\\/g, "/").toLowerCase();
            return p1 === p2;
          });
          filesList.push({
            name: item,
            path: relative.replace(/\\/g, "/"),
            content,
            baseContent: matchingFile ? matchingFile.baseContent : content
          });
        }
      }
    }
    walk(rootDir);
    return filesList;
  }

  const result = await pool.request().query("SELECT * FROM dbo.TaskFiles");
  return result.recordset.map((row: any) => ({
    name: row.FileName,
    path: row.Path,
    content: row.FeatureContent || row.BaseContent || "",
    baseContent: row.BaseContent || ""
  }));
};

// Path for state persistence to prevent stateless Vercel Serverless Function wiping
const getStateFilePath = (fileName: string): string => {
  return path.join(getEnterpriseDir(), fileName);
};

// Writes state array models to persistent local JSON files safely
const saveAppState = () => {
  try {
    const dir = getEnterpriseDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getStateFilePath("tasks.json"), JSON.stringify(codeTasks, null, 2), "utf-8");
    fs.writeFileSync(getStateFilePath("files.json"), JSON.stringify(taskFiles, null, 2), "utf-8");
    fs.writeFileSync(getStateFilePath("conflicts.json"), JSON.stringify(taskConflicts, null, 2), "utf-8");
    fs.writeFileSync(getStateFilePath("recommendations.json"), JSON.stringify(aiRecommendations, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving persistent state snapshot:", err);
  }
};

// Rebuilds files from state back onto the local disk tree physically so standard fs walking doesn't show blank
const syncTaskFilesToPhysicalWorkspace = () => {
  try {
    const root = getEnterpriseDir();
    fs.mkdirSync(root, { recursive: true });
    
    for (const file of taskFiles) {
      const fullPath = path.join(root, file.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      const content = file.isResolved ? file.resolvedContent : file.featureContent;
      fs.writeFileSync(fullPath, content || file.baseContent || "", "utf-8");
    }
    console.log(`Synced ${taskFiles.length} file snapshots physically to workspace under path: ${root}`);
  } catch (err) {
    console.error("Failed to physical sync tasks to disk workspace:", err);
  }
};

// Loads state models and triggers physical file synchronization
const loadAppState = () => {
  try {
    if (isMssqlConfigured()) return;

    const tasksPath = getStateFilePath("tasks.json");
    const filesPath = getStateFilePath("files.json");
    const conflictsPath = getStateFilePath("conflicts.json");
    const recsPath = getStateFilePath("recommendations.json");

    if (fs.existsSync(tasksPath)) {
      codeTasks = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
    } else {
      codeTasks = [...DEFAULT_TASKS];
    }
    
    if (fs.existsSync(filesPath)) {
      taskFiles = JSON.parse(fs.readFileSync(filesPath, "utf-8"));
    } else {
      taskFiles = [...DEFAULT_FILES];
    }
    
    if (fs.existsSync(conflictsPath)) {
      taskConflicts = JSON.parse(fs.readFileSync(conflictsPath, "utf-8"));
    } else {
      taskConflicts = DEFAULT_FILES.filter(f => f.isConflict).map(f => ({
        id: "c_" + f.id.replace("file_", ""),
        taskId: f.taskId,
        fileId: f.id,
        conflictText: f.featureContent,
        resolution: f.resolvedContent,
        auditTrail: [
          `System: Merge conflicts pre-seeded on startup inside ${f.fileName}.`
        ]
      }));
    }
    
    if (fs.existsSync(recsPath)) {
      aiRecommendations = JSON.parse(fs.readFileSync(recsPath, "utf-8"));
    } else {
      aiRecommendations = [
        {
          id: "seed_r1",
          taskId: "TASK-1001",
          category: "Code Quality",
          recommendationText: "Acquiring connections synchronously in a high-throughput webhook handler can deplete pool bag size quickly. Refactor gateway client connections to run in async await blocks."
        },
        {
          id: "seed_r2",
          taskId: "TASK-1003",
          category: "Refactoring",
          recommendationText: "OrderService contains duplicated logging statements and legacy hardcoded payment blocks. Standardize custom client interfaces to abstract stripe gateways."
        }
      ];
    }

    // Always ensure physical files exist on container disk for files browser, walk, and download
    syncTaskFilesToPhysicalWorkspace();

  } catch (err) {
    console.error("Error loading persistent state snapshot:", err);
  }
};

// Seed default tasks and files - Clean Startup (no existing tasks)
const seedTasksAndFiles = () => {
  if (isMssqlConfigured()) return; // Skip seeding local files if using database

  const lockPath = getStateFilePath("seed-clean.lock");
  const tasksPath = getStateFilePath("tasks.json");

  if (fs.existsSync(tasksPath)) {
    loadAppState();
    return;
  }

  // Load the beautiful core seed deck!
  codeTasks = [...DEFAULT_TASKS];
  taskFiles = [...DEFAULT_FILES];
  taskConflicts = DEFAULT_FILES.filter(f => f.isConflict).map(f => ({
    id: "c_" + f.id.replace("file_", ""),
    taskId: f.taskId,
    fileId: f.id,
    conflictText: f.featureContent,
    resolution: f.resolvedContent,
    auditTrail: [
      `System: Merge conflicts pre-seeded on startup inside ${f.fileName}.`
    ]
  }));
  aiRecommendations = [
    {
      id: "seed_r1",
      taskId: "TASK-1001",
      category: "Code Quality",
      recommendationText: "Acquiring connections synchronously in a high-throughput webhook handler can deplete pool bag size quickly. Refactor gateway client connections to run in async await blocks."
    },
    {
      id: "seed_r2",
      taskId: "TASK-1003",
      category: "Refactoring",
      recommendationText: "OrderService contains duplicated logging statements and legacy hardcoded payment blocks. Standardize custom client interfaces to abstract stripe gateways."
    }
  ];

  // Sync to physical disk so the deliverables explorer walks and displays them
  syncTaskFilesToPhysicalWorkspace();
  
  // Save persistent state JSON
  saveAppState();

  try {
    fs.mkdirSync(getEnterpriseDir(), { recursive: true });
    fs.writeFileSync(lockPath, "clean", "utf-8");
  } catch (err) {
    console.error("Failed to write seed-clean.lock:", err);
  }
};

// Execute Seeding on startup
seedTasksAndFiles();

// 2. Initialize Express with clean JSON and urlencoded limits
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Middleware to sync persistent state properly on every api call
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    loadAppState();
  }
  next();
});

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
app.get("/api/tasks", async (req, res) => {
  try {
    const list = await getCodeTasksFromDb();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  const { taskId, baseBranch, featureBranch, description, developer, repositoryUrl } = req.body;
  if (!taskId) return res.status(400).json({ error: "Task ID is required" });

  const targetId = taskId.toUpperCase();
  try {
    const existingTasks = await getCodeTasksFromDb();
    const exists = existingTasks.some(t => {
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

    await saveCodeTaskToDb(newTask);
    res.status(201).json(newTask);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tasks/:taskId", async (req, res) => {
  const { taskId } = req.params;
  const targetId = taskId.toUpperCase();

  const matchTask = (id: string | undefined | null) => {
    if (!id) return false;
    const clean = String(id).toUpperCase();
    return clean === targetId || clean === `TASK-${targetId}` || `TASK-${clean}` === targetId;
  };

  try {
    const existingTasks = await getCodeTasksFromDb();
    const exists = existingTasks.some(t => matchTask(t.taskId));
    if (!exists) {
      return res.status(404).json({ error: "Task not found" });
    }

    // Delete files physically from local workspace if possible
    const filesToDelete = await getTaskFilesFromDb(taskId);
    for (const file of filesToDelete) {
      const fullPath = path.join(getEnterpriseDir(), file.path);
      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (err) {
        console.error(`Failed to delete physical file ${fullPath}:`, err);
      }
    }

    await deleteCodeTaskFromDb(taskId);
    deleteEmptyDirectories(getEnterpriseDir());

    res.json({
      success: true,
      message: `Task ${taskId} and all its associated file snapshots, conflicts, and recommendations have been permanently deleted.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/files/:fileId", async (req, res) => {
  const { fileId } = req.params;
  const { featureContent } = req.body;
  try {
    const file = await getTaskFileByIdFromDb(fileId);
    if (!file) return res.status(404).json({ error: "File snapshot not found" });

    file.featureContent = featureContent || "";
    
    // If the file was a conflict but the markers are now removed, mark it resolved
    if (file.isConflict) {
      if (!file.featureContent.includes("<<<<<<< HEAD") && !file.featureContent.includes("=======") && !file.featureContent.includes(">>>>>>>")) {
        file.isResolved = true;
      }
    }

    await saveTaskFileToDb(file);

    // Sync to physical server workspace if accessible
    const fullPath = path.join(getEnterpriseDir(), file.path);
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.featureContent, "utf-8");
    } catch (err) {
      console.warn("Failed to sync updated file to disk physically:", err);
    }

    res.json({
      success: true,
      message: `Successfully updated code snapshot for file ${file.fileName}.`,
      file
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:taskId/files", async (req, res) => {
  const { taskId } = req.params;
  try {
    const files = await getTaskFilesFromDb(taskId);
    res.json(files);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/files/:fileId", async (req, res) => {
  const { fileId } = req.params;
  try {
    const file = await getTaskFileByIdFromDb(fileId);
    if (!file) return res.status(404).json({ error: "File snapshot not found" });

    await deleteTaskFileFromDb(fileId);

    // Sync deletion with physical server workspace
    const fullPath = path.join(getEnterpriseDir(), file.path);
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (err) {
      console.warn("Failed to delete physical file:", err);
    }

    deleteEmptyDirectories(getEnterpriseDir());

    res.json({
      success: true,
      message: `Successfully deleted file snapshot ${file.fileName}.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/files/:fileId/content", async (req, res) => {
  try {
    const file = await getTaskFileByIdFromDb(req.params.fileId);
    if (!file) return res.status(404).json({ error: "File not found" });
    res.json(file);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks/:taskId/files", async (req, res) => {
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
    baseContent: baseContent || featureContent || "",
    featureContent: featureContent || "",
    resolvedContent: "",
    isConflict: startsWithConflict,
    isResolved: false
  };

  try {
    await saveTaskFileToDb(newFile);

    // Sync upload with physical server workspace if accessible
    const fullPath = path.join(getEnterpriseDir(), filePath || fileName);
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, featureContent || baseContent || "", "utf-8");
    } catch (err) {
      console.warn("Failed to write physical uploaded file to disk:", err);
    }

    res.status(201).json(newFile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
app.post("/api/tasks/merge-resolution", async (req, res) => {
  const { fileId, resolution, actionName } = req.body;
  try {
    const file = await resolveMergeConflictInDb(fileId, resolution, actionName);
    if (!file) return res.status(404).json({ error: "File record not found" });

    res.json({ message: "Merge conflict successfully resolved!", file });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get metrics state
app.get("/api/dashboard/metrics", async (req, res) => {
  try {
    const stats = await getDashboardMetricsFromDb();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Retrieve Recommendations
app.get("/api/tasks/:taskId/recommendations", async (req, res) => {
  try {
    const recs = await getRecommendationsFromDb(req.params.taskId);
    res.json(recs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Run Live Gemini AI Recommendations Review
app.post("/api/tasks/:taskId/ai-suggestions", async (req, res) => {
  const { taskId } = req.params;
  try {
    const files = await getTaskFilesFromDb(taskId);
    
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

        await saveRecommendationsToDb(taskId, items);
        return res.json(items);
      } catch (ex: any) {
        console.error("Gemini runtime fail: ", ex);
      }
    }

    // Fallback reviews
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
    
    await saveRecommendationsToDb(taskId, fallback);
    res.json(fallback);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve list of written deliverables from physical filesystem
app.get("/api/deliverables/files", async (req, res) => {
  try {
    const list = await getDeliverablesFromDb();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/deliverables/files", async (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: "File path parameter 'path' is required" });

  try {
    const isDb = isMssqlConfigured();
    if (isDb) {
      const standardRelPath = relPath.replace(/\\/g, "/");
      const deliverables = await getDeliverablesFromDb();
      const matching = deliverables.find(d => d.path.toLowerCase() === standardRelPath.toLowerCase());
      if (matching) {
        const pool = await getDbPool();
        if (pool) {
          const mssql = await loadMssql();
          await pool.request()
            .input("Path", mssql.NVarChar(1000), matching.path)
            .query("DELETE FROM dbo.TaskFiles WHERE Path = @Path");
        }
      }
    }

    // Convert all backslashes to forward slashes first to standardise, then normalize
    const standardRelPath = relPath.replace(/\\/g, "/");
    const cleanPath = path.normalize(standardRelPath).replace(/^(\.\.(\/|\\|$))+/, "");
    
    // Resolve path segments independently to bypass platform path separator differences
    const segments = cleanPath.split(/[/\\]/).filter(Boolean);
    let fullPath = path.join(getEnterpriseDir(), ...segments);

    if (!fs.existsSync(fullPath)) {
      const altPath = path.join(getEnterpriseDir(), relPath.replace(/\\/g, path.sep));
      if (fs.existsSync(altPath)) {
        fullPath = altPath;
      }
    }

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

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    // Clear local cache mismatch too
    const fileNameLower = path.basename(standardRelPath).toLowerCase();
    taskFiles = taskFiles.filter(tf => {
      const tfPath = String(tf.path || "").replace(/\\/g, "/").toLowerCase();
      const tfName = String(tf.fileName || "").toLowerCase();
      return tfPath !== standardRelPath.toLowerCase() && tfName !== fileNameLower;
    });

    saveAppState();
    deleteEmptyDirectories(getEnterpriseDir());

    res.json({ success: true, message: `Successfully deleted deliverable ${relPath} and cleared task workspace references.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dynamic CSV Report download route
app.get("/api/reports/download-csv", async (req, res) => {
  const taskId = req.query.taskId as string || "TASK-1001";
  try {
    const list = await getCodeTasksFromDb();
    const task = list.find(t => t.taskId === taskId) || list[0];
    if (!task) return res.status(404).send("No valid active tasks found to compile a CSV progress report.");

    const files = await getTaskFilesFromDb(task.taskId);

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
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

// 5. Mount Vite integration and launch Server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
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
    console.log("Full-stack CodeShield Workspace booted successfully up on port 3000");
  });
}

// Run standalone web server locally or in standard Docker/Cloud Run environments
if (!process.env.VERCEL) {
  startServer();
}

export default app;
