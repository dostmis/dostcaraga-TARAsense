<?php

namespace App\Models;

class SensoryResponseDraft extends PrismaModel
{
    protected $table = 'SensoryResponseDraft';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'studyId', 'participantId', 'data', 'version',
        'expiresAt', 'createdAt', 'updatedAt',
    ];

    protected $casts = [
        'data' => 'json',
        'version' => 'integer',
        'expiresAt' => 'datetime',
        'createdAt' => 'datetime',
        'updatedAt' => 'datetime',
    ];

    public function study()
    {
        return $this->belongsTo(Study::class, 'studyId');
    }

    public function participant()
    {
        return $this->belongsTo(StudyParticipant::class, 'participantId');
    }
}
