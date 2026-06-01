<?php

namespace App\Models;

class FicAvailability extends PrismaModel
{
    protected $table = 'FicAvailability';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'ficUserId', 'date', 'isAvailable', 'isLocked',
        'lockedById', 'lockedAt', 'createdAt', 'updatedAt',
    ];

    protected $casts = [
        'isAvailable' => 'boolean',
        'isLocked' => 'boolean',
        'lockedAt' => 'datetime',
        'createdAt' => 'datetime',
        'updatedAt' => 'datetime',
    ];

    public function ficUser()
    {
        return $this->belongsTo(User::class, 'ficUserId');
    }
}
