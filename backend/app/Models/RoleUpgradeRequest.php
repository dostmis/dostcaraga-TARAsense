<?php

namespace App\Models;

class RoleUpgradeRequest extends PrismaModel
{
    protected $table = 'RoleUpgradeRequest';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'userId', 'targetRole', 'status', 'reason',
        'adminId', 'reviewedAt', 'createdAt', 'updatedAt',
    ];

    protected $casts = [
        'reviewedAt' => 'datetime',
        'createdAt' => 'datetime',
        'updatedAt' => 'datetime',
    ];
}
