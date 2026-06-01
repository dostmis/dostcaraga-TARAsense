<?php

namespace App\Models;

class Notification extends PrismaModel
{
    protected $table = 'Notification';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'userId', 'title', 'message', 'level', 'category',
        'actionUrl', 'metadata', 'isRead', 'createdAt', 'updatedAt',
    ];

    protected $casts = [
        'metadata' => 'json',
        'isRead' => 'boolean',
        'createdAt' => 'datetime',
        'updatedAt' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class, 'userId');
    }
}
