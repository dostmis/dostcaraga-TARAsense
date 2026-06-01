<?php

namespace App\Models;

class DeviceToken extends PrismaModel
{
    protected $table = 'DeviceToken';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'userId', 'token', 'platform', 'createdAt', 'updatedAt',
    ];

    protected $casts = [
        'createdAt' => 'datetime',
        'updatedAt' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class, 'userId');
    }
}
