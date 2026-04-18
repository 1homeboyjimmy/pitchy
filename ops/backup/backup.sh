#!/bin/bash

# Configuration
BACKUP_DIR="backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="postgres_${TIMESTAMP}.sql.gz"
LATEST_NAME="postgres.sql.gz"
RETENTION_DAYS=7

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "Starting logical backup for Postgres..."

# Run pg_dump inside the container
# We use docker exec to run pg_dump as the postgres user
# It's streamed to gzip and saved to the backups folder
docker exec postgres pg_dump -U app_user -d app | gzip > "$BACKUP_DIR/$BACKUP_NAME"

if [ $? -eq 0 ]; then
    echo "Backup completed successfully: $BACKUP_DIR/$BACKUP_NAME"
    
    # Create a copy for the automated verification script
    cp "$BACKUP_DIR/$BACKUP_NAME" "$BACKUP_DIR/$LATEST_NAME"
    
    # Rotation: Delete backups older than RETENTION_DAYS
    find "$BACKUP_DIR" -name "postgres_*.sql.gz" -mtime +$RETENTION_DAYS -delete
    echo "Cleanup of backups older than $RETENTION_DAYS days completed."
else
    echo "ERROR: Backup failed!"
    exit 1
fi

# Optional: Trigger verification
if [ -f "ops/backup/verify_restore.sh" ]; then
    echo "Triggering verification..."
    bash ops/backup/verify_restore.sh
fi
