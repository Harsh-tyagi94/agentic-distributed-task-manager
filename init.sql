CREATE TABLE IF NOT EXISTS job_audit (
    job_id VARCHAR(255) PRIMARY KEY,
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    job_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, active, completed, failed
    retry_count INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    result_summary TEXT,
    error_log TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_job_status ON job_audit(status);
CREATE INDEX idx_idempotency ON job_audit(idempotency_key);
