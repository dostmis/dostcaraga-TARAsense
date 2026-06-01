<?php

namespace App\Models;

class SensoryResponse extends PrismaModel
{
    protected $table = 'SensoryResponse';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'studyId', 'participantId', 'data', 'submittedAt',
    ];

    protected $casts = [
        'data' => 'json',
        'submittedAt' => 'datetime',
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
