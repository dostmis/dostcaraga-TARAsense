<?php

namespace App\Models;

/**
 * Mirrors Prisma User model.
 * Table: User (camelCase, matching Prisma default table naming).
 */
class User extends PrismaModel
{
    protected $table = 'User';

    public $incrementing = false;
    protected $keyType = 'string';
    protected $primaryKey = 'id';
    public $timestamps = false;

    protected $fillable = [
        'id', 'email', 'password', 'name', 'role', 'organization',
        'assignedRegion', 'assignedFacility', 'assignmentUpdatedAt',
        'assignmentUpdatedById', 'createdAt', 'updatedAt',
    ];

    protected $casts = [
        'assignmentUpdatedAt' => 'datetime',
        'createdAt' => 'datetime',
        'updatedAt' => 'datetime',
    ];

    public function deviceTokens()
    {
        return $this->hasMany(DeviceToken::class, 'userId');
    }

    public function profile()
    {
        return $this->hasOne(UserProfile::class, 'userId');
    }

    public function panelistProfile()
    {
        return $this->hasOne(Panelist::class, 'userId');
    }

    public function notifications()
    {
        return $this->hasMany(Notification::class, 'userId');
    }

    public function ficAvailability()
    {
        return $this->hasMany(FicAvailability::class, 'ficUserId');
    }

    public function studies()
    {
        return $this->hasMany(Study::class, 'creatorId');
    }
}
