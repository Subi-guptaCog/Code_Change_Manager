-- =================================================================================
-- MICROSOFT SQL SERVER / SSMS DATABASE SETUP SCRIPT
-- Application: CodeShield Code Change Manager Workspace
-- Target Platform: Microsoft SQL Server (SSMS compatible)
-- Description: Sets up the schema for persistent code change tracking.
-- =================================================================================

-- ---------------------------------------------------------------------------------
-- STEP 1: CREATE DATABASE
-- Connect to your SQL Server instance in SSMS, open a New Query window, and execute:
-- ---------------------------------------------------------------------------------
USE master;
GO

IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'CodeChangeManagerDb')
BEGIN
    CREATE DATABASE CodeChangeManagerDb;
    PRINT 'Database "CodeChangeManagerDb" created successfully.';
END
ELSE
BEGIN
    PRINT 'Database "CodeChangeManagerDb" already exists.';
END
GO

USE CodeChangeManagerDb;
GO

-- ---------------------------------------------------------------------------------
-- STEP 2: CREATE TABLES
-- ---------------------------------------------------------------------------------

-- A. CodeTasks Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CodeTasks]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[CodeTasks] (
        [TaskId] NVARCHAR(100) NOT NULL,
        [BaseBranch] NVARCHAR(100) NOT NULL CONSTRAINT [DF_CodeTasks_BaseBranch] DEFAULT 'main',
        [FeatureBranch] NVARCHAR(100) NOT NULL,
        [Description] NVARCHAR(MAX) NULL,
        [Developer] NVARCHAR(100) NOT NULL CONSTRAINT [DF_CodeTasks_Developer] DEFAULT 'Lead Developer',
        [CreatedDate] DATETIME2 NOT NULL CONSTRAINT [DF_CodeTasks_CreatedDate] DEFAULT GETUTCDATE(),
        [RepositoryUrl] NVARCHAR(2083) NULL CONSTRAINT [DF_CodeTasks_Repository] DEFAULT 'https://github.com/enterprise/source.git',
        [CommitId] NVARCHAR(100) NULL,
        CONSTRAINT [PK_CodeTasks] PRIMARY KEY CLUSTERED ([TaskId] ASC)
    );
    PRINT 'Table "CodeTasks" created successfully.';
END
GO

-- B. TaskFiles Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TaskFiles]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TaskFiles] (
        [Id] NVARCHAR(100) NOT NULL,
        [TaskId] NVARCHAR(100) NOT NULL,
        [FileName] NVARCHAR(255) NOT NULL,
        [Path] NVARCHAR(1000) NOT NULL,
        [Extension] NVARCHAR(50) NOT NULL,
        [BaseContent] NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_TaskFiles_BaseContent] DEFAULT '',
        [FeatureContent] NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_TaskFiles_FeatureContent] DEFAULT '',
        [ResolvedContent] NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_TaskFiles_ResolvedContent] DEFAULT '',
        [IsConflict] BIT NOT NULL CONSTRAINT [DF_TaskFiles_IsConflict] DEFAULT 0,
        [IsResolved] BIT NOT NULL CONSTRAINT [DF_TaskFiles_IsResolved] DEFAULT 0,
        CONSTRAINT [PK_TaskFiles] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [FK_TaskFiles_CodeTasks] FOREIGN KEY ([TaskId]) 
            REFERENCES [dbo].[CodeTasks] ([TaskId]) 
            ON DELETE CASCADE
    );
    CREATE NONCLUSTERED INDEX [IX_TaskFiles_TaskId] ON [dbo].[TaskFiles] ([TaskId] ASC);
    PRINT 'Table "TaskFiles" created successfully.';
END
GO

-- C. TaskConflicts Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TaskConflicts]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TaskConflicts] (
        [Id] NVARCHAR(100) NOT NULL,
        [TaskId] NVARCHAR(100) NOT NULL,
        [FileId] NVARCHAR(100) NOT NULL,
        [ConflictText] NVARCHAR(MAX) NOT NULL,
        [Resolution] NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_TaskConflicts_Resolution] DEFAULT '',
        [AuditTrail] NVARCHAR(MAX) NOT NULL CONSTRAINT [DF_TaskConflicts_AuditTrail] DEFAULT '[]', -- Stored as JSON string
        CONSTRAINT [PK_TaskConflicts] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [FK_TaskConflicts_CodeTasks] FOREIGN KEY ([TaskId]) 
            REFERENCES [dbo].[CodeTasks] ([TaskId]) 
            ON DELETE NO ACTION, -- Managed manually on cascade to prevent circular constraints
        CONSTRAINT [FK_TaskConflicts_TaskFiles] FOREIGN KEY ([FileId]) 
            REFERENCES [dbo].[TaskFiles] ([Id]) 
            ON DELETE CASCADE
    );
    CREATE NONCLUSTERED INDEX [IX_TaskConflicts_TaskId] ON [dbo].[TaskConflicts] ([TaskId] ASC);
    CREATE NONCLUSTERED INDEX [IX_TaskConflicts_FileId] ON [dbo].[TaskConflicts] ([FileId] ASC);
    PRINT 'Table "TaskConflicts" created successfully.';
END
GO

-- D. AiRecommendations Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[AiRecommendations]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[AiRecommendations] (
        [Id] NVARCHAR(100) NOT NULL,
        [TaskId] NVARCHAR(100) NOT NULL,
        [Category] NVARCHAR(100) NOT NULL,
        [RecommendationText] NVARCHAR(MAX) NOT NULL,
        CONSTRAINT [PK_AiRecommendations] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [FK_AiRecommendations_CodeTasks] FOREIGN KEY ([TaskId]) 
            REFERENCES [dbo].[CodeTasks] ([TaskId]) 
            ON DELETE CASCADE
    );
    CREATE NONCLUSTERED INDEX [IX_AiRecommendations_TaskId] ON [dbo].[AiRecommendations] ([TaskId] ASC);
    PRINT 'Table "AiRecommendations" created successfully.';
END
GO

-- ---------------------------------------------------------------------------------
-- STEP 3: VERIFICATION
-- Run this block to confirm everything is set up correctly
-- ---------------------------------------------------------------------------------
SELECT TABLE_NAME, TABLE_TYPE 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_CATALOG = 'CodeChangeManagerDb' AND TABLE_SCHEMA = 'dbo';
GO

PRINT '=================================================================================';
PRINT '   DBSchema created successfully! You are ready to connect the app.';
PRINT '=================================================================================';
