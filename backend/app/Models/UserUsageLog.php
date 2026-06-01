<?php

namespace App\Models;

class UserUsageLog extends PrismaModel
{
    protected $table = 'UserUsageLog';

    protected $fillable = [
        'id', 'actorUserId', 'actorName', 'actorEmail', 'actorRole',
        'action', 'entityType', 'entityId', 'summary', 'metadata',
        'ipAddress', 'userAgent', 'createdAt',
    ];

    protected $casts = [
        'metadata' => 'json',
        'createdAt' => 'datetime',
    ];

    public function actor()
    {
        return $this->belongsTo(User::class, 'actorUserId');
    }
}
