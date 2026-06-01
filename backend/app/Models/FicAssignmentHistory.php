<?php

namespace App\Models;

class FicAssignmentHistory extends PrismaModel
{
    protected $table = 'FicAssignmentHistory';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'ficUserId', 'changedById', 'previousRegion',
        'previousFacility', 'assignedRegion', 'assignedFacility', 'createdAt',
    ];

    protected $casts = [
        'createdAt' => 'datetime',
    ];

    public function ficUser()
    {
        return $this->belongsTo(User::class, 'ficUserId');
    }
}
