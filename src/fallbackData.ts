import { CodeTask, TaskFile, AIRecommendation } from "./types";

export const DEFAULT_TASKS: CodeTask[] = [
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

export const DEFAULT_FILES: TaskFile[] = [
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
        public async Task<OrderResponse> ProcessOrderAsync(OrderRequest request)
        {
            <<<<<<< HEAD
            // Charge legacy payment merchant system (Fallback payment provider)
            var response = await _legacyGateway.ChargeAsync(request.UserId, request.Subtotal);
            return new OrderResponse { Success = response.Success, Code = "LEGACY_PAY" };
            =======
            // Stripe API Integration (Modern Checkout pipeline)
            var session = await _stripeService.CreateSessionAsync(request.Email, request.Subtotal);
            return new OrderResponse { Success = session.IsActive, Code = "STRIPE_SUCCESS" };
            >>>>>>> feature/stripe-payment
        }
    }
}`,
    resolvedContent: "",
    isConflict: true,
    isResolved: false
  }
];

export const DEFAULT_AI_RECOMMENDATIONS: AIRecommendation[] = [
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
